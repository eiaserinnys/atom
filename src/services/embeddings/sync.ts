import type { DatabaseAdapter } from "../../db/adapter.js";
import { deleteStaleEmbeddings, listEmbeddingCandidates, listStaleEmbeddingIds, markEmbeddingVersion, saveEmbedding } from "../../db/queries/embeddings.js";
import { getOpenAIKeyForWorker } from "../../db/queries/openai-settings.js";
import type { AtomEvent } from "../../events/eventBus.js";
import { eventBus as defaultEventBus } from "../../events/eventBus.js";
import type { EmbeddingErrorKind, EmbeddingPauseReason, OpenAIConfigResponse } from "../../shared/embeddings.js";
import type { FlatEmbeddingIndex } from "./flat-index.js";
import { createEmbeddingInput } from "./input.js";
import { EmbeddingClientError, requestEmbeddings, splitEmbeddingBatches } from "./client.js";
import { serializeEmbedding } from "./binary.js";
import { EMBEDDING_POLICY } from "./policy.js";

interface EmbeddingLogger {
  warn?(record: { event: "embedding.failed"; kind: EmbeddingErrorKind; http_status: number | null }): void;
}

export interface EmbeddingSyncDependencies {
  db: DatabaseAdapter;
  index: FlatEmbeddingIndex;
  fetcher?: typeof fetch;
  events?: typeof defaultEventBus;
  logger?: EmbeddingLogger;
  now?: () => number;
}

export interface EmbeddingSync {
  start(): void;
  stop(): Promise<void>;
  requestRun(): void;
  credentialsChanged(): void;
  waitForIdle(): Promise<void>;
  status(): {
    running: boolean;
    paused_reason: EmbeddingPauseReason;
    last_error: OpenAIConfigResponse["embedding"]["last_error"];
  };
}

interface PreparedCandidate {
  cardId: string;
  version: number;
  contentHash: string;
  tokenCount: number;
  truncated: boolean;
  inputTokens: number[];
}

export function createEmbeddingSync(deps: EmbeddingSyncDependencies): EmbeddingSync {
  const events = deps.events ?? defaultEventBus;
  const now = deps.now ?? Date.now;
  let disposed = false;
  let started = false;
  let isRunning = false;
  let pending = false;
  let generation = 0;
  let pausedReason: EmbeddingPauseReason = null;
  let lastError: OpenAIConfigResponse["embedding"]["last_error"] = null;
  let blockedUntil = 0;
  let runPromise: Promise<void> | null = null;
  let activeController: AbortController | null = null;
  let debounceTimer: NodeJS.Timeout | null = null;
  let sweepTimer: NodeJS.Timeout | null = null;
  let resumeTimer: NodeJS.Timeout | null = null;

  const onEvent = (event: AtomEvent): void => {
    if (event.type === "card:deleted") void deps.index.remove(event.cardId).catch(() => undefined);
    if (event.type === "batch:completed") {
      for (const patch of event.patches) {
        if (patch.type === "card:deleted") void deps.index.remove(patch.cardId).catch(() => undefined);
      }
    }
    if (["card:created", "card:updated", "node:created", "node:deleted", "batch:completed"].includes(event.type)) {
      if (pausedReason !== null) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        requestRun();
      }, EMBEDDING_POLICY.debounceMs);
    }
  };

  function requestRun(): void {
    if (disposed || pausedReason !== null) return;
    if (now() < blockedUntil) return;
    pending = true;
    if (!runPromise) {
      const running = drain().finally(() => {
        if (runPromise === running) runPromise = null;
        if (pending && !disposed && pausedReason === null && now() >= blockedUntil) requestRun();
      });
      runPromise = running;
    }
  }

  async function drain(): Promise<void> {
    isRunning = true;
    try {
      while (pending && !disposed && pausedReason === null && now() >= blockedUntil) {
        pending = false;
        await runPass();
      }
    } finally {
      isRunning = false;
    }
  }

  async function runPass(): Promise<void> {
    const passGeneration = generation;
    let hasKey: string | null;
    try {
      hasKey = await getOpenAIKeyForWorker(deps.db);
    } catch {
      fail("EMBEDDING_STORAGE", null, passGeneration);
      return;
    }
    if (passGeneration !== generation || disposed) return;
    if (!hasKey) {
      pausedReason = "no_key";
      return;
    }
    pausedReason = null;

    try {
      for (;;) {
        const staleIds = await listStaleEmbeddingIds(deps.db);
        if (staleIds.length === 0) break;
        await deps.index.commitRemoval(() => deleteStaleEmbeddings(deps.db, staleIds));
        if (passGeneration !== generation || disposed) return;
      }

      let afterId: string | null = null;
      for (;;) {
        const candidates = await listEmbeddingCandidates(deps.db, afterId);
        if (candidates.length === 0) break;
        afterId = candidates[candidates.length - 1].card_id;
        const prepared: PreparedCandidate[] = [];
        for (const candidate of candidates) {
          const input = await createEmbeddingInput(candidate.title, candidate.content);
          if (candidate.content_hash === input.contentHash && candidate.model === EMBEDDING_POLICY.model && candidate.dimensions === EMBEDDING_POLICY.dimensions) {
            await deps.index.commitVersion(candidate.card_id, candidate.version,
              () => markEmbeddingVersion(deps.db, candidate.card_id, input.contentHash, candidate.version));
            continue;
          }
          prepared.push({
            cardId: candidate.card_id,
            version: candidate.version,
            contentHash: input.contentHash,
            tokenCount: input.tokenCount,
            truncated: input.truncated,
            inputTokens: input.inputTokens,
          });
        }
        for (const batch of splitEmbeddingBatches(prepared)) {
          if (passGeneration !== generation || disposed) return;
          const key = await getOpenAIKeyForWorker(deps.db);
          if (!key) {
            pausedReason = "no_key";
            return;
          }
          await embedBatch(batch, key, passGeneration);
        }
        if (passGeneration !== generation || disposed) return;
      }
      if (passGeneration === generation && !disposed) {
        lastError = null;
        if (pausedReason !== "no_key") pausedReason = null;
        blockedUntil = 0;
      }
    } catch (error) {
      if (passGeneration !== generation || disposed) return;
      if (error instanceof EmbeddingClientError) {
        fail(error.kind, error.httpStatus, passGeneration);
        if (error.kind === "OPENAI_RATE_LIMIT") {
          const waitMs = error.retryAfterMs ?? EMBEDDING_POLICY.sweepIntervalMs;
          pausedReason = "rate_limited";
          blockedUntil = now() + waitMs;
          resumeTimer = setTimeout(() => {
            resumeTimer = null;
            if (disposed || generation !== passGeneration) return;
            pausedReason = null;
            blockedUntil = 0;
            requestRun();
          }, waitMs);
        }
      } else {
        fail("EMBEDDING_STORAGE", null, passGeneration);
      }
    }
  }

  async function embedBatch(batch: PreparedCandidate[], key: string, passGeneration: number): Promise<void> {
    const controller = new AbortController();
    activeController = controller;
    const timeout = setTimeout(() => controller.abort(), EMBEDDING_POLICY.requestTimeoutMs);
    let vectors: number[][];
    try {
      vectors = await requestEmbeddings(key, batch.map(row => row.inputTokens), controller.signal, deps.fetcher);
    } finally {
      clearTimeout(timeout);
      if (activeController === controller) activeController = null;
    }
    if (passGeneration !== generation || disposed) return;
    const embeddedAt = new Date(now()).toISOString();
    for (let i = 0; i < batch.length; i += 1) {
      const candidate = batch[i];
      const embedding = serializeEmbedding(vectors[i]);
      await deps.index.commitEmbedding(candidate.cardId, candidate.version, embedding, () => saveEmbedding(deps.db, {
        cardId: candidate.cardId,
        version: candidate.version,
        contentHash: candidate.contentHash,
        tokenCount: candidate.tokenCount,
        truncated: candidate.truncated,
        embedding,
        embeddedAt,
      }));
      if (passGeneration !== generation || disposed) return;
    }
  }

  function fail(kind: EmbeddingErrorKind, httpStatus: number | null, passGeneration: number): void {
    if (passGeneration !== generation) return;
    lastError = { kind, http_status: httpStatus };
    if (kind === "OPENAI_AUTH") pausedReason = "auth";
    else if (kind !== "OPENAI_RATE_LIMIT") {
      blockedUntil = now() + EMBEDDING_POLICY.sweepIntervalMs;
    }
    try { deps.logger?.warn?.({ event: "embedding.failed", kind, http_status: httpStatus }); } catch { /* logging must not change sync behavior */ }
  }

  function start(): void {
    if (started || disposed) return;
    started = true;
    events.onAtomEvent(onEvent);
    sweepTimer = setInterval(() => requestRun(), EMBEDDING_POLICY.sweepIntervalMs);
    requestRun();
  }

  async function stop(): Promise<void> {
    if (disposed) return;
    disposed = true;
    if (sweepTimer) clearInterval(sweepTimer);
    if (debounceTimer) clearTimeout(debounceTimer);
    if (resumeTimer) clearTimeout(resumeTimer);
    sweepTimer = null;
    debounceTimer = null;
    resumeTimer = null;
    if (started) events.offAtomEvent(onEvent);
    activeController?.abort();
    await runPromise;
  }

  function credentialsChanged(): void {
    if (disposed) return;
    generation += 1;
    activeController?.abort();
    if (resumeTimer) clearTimeout(resumeTimer);
    resumeTimer = null;
    pausedReason = null;
    lastError = null;
    blockedUntil = 0;
    requestRun();
  }

  async function waitForIdle(): Promise<void> {
    await runPromise;
  }

  return {
    start,
    stop,
    requestRun,
    credentialsChanged,
    waitForIdle,
    status: () => ({ running: isRunning, paused_reason: pausedReason, last_error: lastError }),
  };
}
