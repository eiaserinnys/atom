import { randomUUID } from "node:crypto";
import { getDb } from "../../db/client.js";
import { selectCanonicalEvaluationNodeId } from "../../db/queries/visual-search-evaluation.js";
import { selectCardById } from "../../db/queries/cards.js";
import type { TreeNodeWithCard } from "../../shared/types.js";
import type { JevAuditCall, JevMeaningPayload, JevMeaningResponse, JevSearchContext } from "../../shared/jev-search.js";
import type { JevEvaluationInput, JevEvaluationResponse, JevEvaluationSkipReason } from "../../shared/visual-search.js";
import { getNode } from "../tree.service.js";
import { candidateFromNode } from "./catalog.js";
import { JevClient, JevError } from "./client.js";
import { JevSearchConfigError, JEV_SEARCH_POLICY, type JevSearchPolicy, readJevServerConfig } from "./config.js";
import { makeAuditCall, meaningAuditRequest } from "./audit.js";
import { buildContentPayload, JevAnswerError, normalizeContext, normalizeQuery, noul, type JevPromptCandidate } from "./prompts.js";
import { tryAcquireJevRunSlot } from "./run-slots.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface JevEvaluationCandidate extends JevPromptCandidate {
  cardVersion: number;
}

export interface JevEvaluationDependencies {
  loadCandidates(cardIds: string[], signal: AbortSignal): Promise<{
    candidates: JevEvaluationCandidate[];
    skipped: Array<{ card_id: string; reason: JevEvaluationSkipReason }>;
  }>;
  prepareJudge?(): void;
  judge(payload: JevMeaningPayload, signal?: AbortSignal): Promise<JevMeaningResponse>;
  policy?: JevSearchPolicy;
}

export class JevEvaluationRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
    readonly evaluation_id?: string,
    readonly audit?: { calls: JevAuditCall[] },
  ) {
    super(message);
    this.name = "JevEvaluationRequestError";
  }
}

export async function evaluateJevCards(
  rawInput: JevEvaluationInput,
  deps: JevEvaluationDependencies,
  callerSignal?: AbortSignal,
): Promise<JevEvaluationResponse> {
  const policy = deps.policy ?? JEV_SEARCH_POLICY;
  const input = normalizeEvaluationInput(rawInput, policy);
  const releaseSlot = tryAcquireJevRunSlot(policy.maxConcurrentRuns);
  if (!releaseSlot) throw new JevEvaluationRequestError("Jev evaluation is busy.", "JEV_EVALUATION_BUSY", 429);

  const evaluationId = randomUUID();
  const controller = new AbortController();
  let timedOut = false;
  const onCallerAbort = () => controller.abort();
  if (callerSignal?.aborted) controller.abort();
  else callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, policy.runTimeoutMs);
  timeout.unref?.();

  try {
    assertRunning(controller.signal, timedOut, evaluationId);
    let loaded: Awaited<ReturnType<JevEvaluationDependencies["loadCandidates"]>>;
    try {
      loaded = await withAbort(deps.loadCandidates(input.card_ids, controller.signal), controller.signal);
    } catch (cause) {
      assertRunning(controller.signal, timedOut, evaluationId);
      throw cause;
    }
    assertRunning(controller.signal, timedOut, evaluationId);

    const candidateById = new Map(loaded.candidates.map(candidate => [candidate.cardId, candidate]));
    const skippedById = new Map(loaded.skipped.map(entry => [entry.card_id, entry.reason]));
    const candidates = input.card_ids.flatMap(cardId => candidateById.has(cardId) ? [candidateById.get(cardId)!] : []);
    const skipped = input.card_ids.flatMap(cardId => {
      const reason = skippedById.get(cardId);
      return reason ? [{ card_id: cardId, reason }] : [];
    });
    if (candidates.length === 0) {
      return { evaluation_id: evaluationId, query: input.query, model: "jev-latest", results: [], skipped, audit: { calls: [] } };
    }

    const payload = buildContentPayload(input.query, input.context, candidates);
    if (JSON.stringify(payload).length > policy.payloadMaxChars) {
      throw new JevEvaluationRequestError("Evaluation payload exceeds the configured limit.", "JEV_EVALUATION_PAYLOAD_TOO_LARGE", 413, evaluationId);
    }
    assertRunning(controller.signal, timedOut, evaluationId);
    try {
      deps.prepareJudge?.();
    } catch (cause) {
      if (cause instanceof JevSearchConfigError) {
        throw new JevEvaluationRequestError("Jev evaluation is not configured.", "JEV_NOT_CONFIGURED", 503, evaluationId);
      }
      throw new JevEvaluationRequestError("Jev evaluation failed.", "JEV_EVALUATION_FAILED", 500, evaluationId);
    }

    const callId = `${evaluationId}:call:000001`;
    const startedAt = new Date().toISOString();
    const auditInput = {
      callId,
      runId: evaluationId,
      seq: 1,
      stage: "content_noul" as const,
      candidateCount: candidates.length,
      startedAt,
      startedClock: performance.now(),
      request: meaningAuditRequest(payload),
    };
    let response: JevMeaningResponse | undefined;
    let scores: number[];
    try {
      response = await withAbort(deps.judge(payload, controller.signal), controller.signal);
      assertRunning(controller.signal, timedOut, evaluationId);
      scores = candidates.map((_candidate, index) => noul(response!, `content_${index}`));
    } catch (cause) {
      const failure = evaluationFailure(cause, timedOut, controller.signal);
      const auditCall = makeAuditCall(auditInput, {
        completedAt: new Date().toISOString(),
        response,
        error: { code: failure.code, message: failure.message },
        disposition: "error",
      });
      throw new JevEvaluationRequestError(failure.message, failure.code, failure.statusCode, evaluationId, { calls: [auditCall] });
    }

    const auditCall = makeAuditCall(auditInput, { completedAt: new Date().toISOString(), response });
    return {
      evaluation_id: evaluationId,
      query: input.query,
      model: "jev-latest",
      results: candidates.map((candidate, index) => ({
        card_id: candidate.cardId,
        node_id: candidate.nodeId,
        card_version: candidate.cardVersion,
        score: scores[index]!,
        call_id: callId,
        question_key: `content_${index}`,
      })),
      skipped,
      audit: { calls: [auditCall] },
    };
  } catch (cause) {
    if (cause instanceof JevEvaluationRequestError) throw cause;
    assertRunning(controller.signal, timedOut, evaluationId);
    throw new JevEvaluationRequestError("Jev evaluation failed.", "JEV_EVALUATION_FAILED", 500, evaluationId);
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", onCallerAbort);
    releaseSlot();
  }
}

export async function runConfiguredJevEvaluation(input: JevEvaluationInput, signal?: AbortSignal): Promise<JevEvaluationResponse> {
  let client: JevClient | null = null;
  return evaluateJevCards(input, {
    loadCandidates: loadEvaluationCandidates,
    prepareJudge: () => {
      const config = readJevServerConfig();
      client = new JevClient(config.baseUrl, config.apiKey);
    },
    judge: (payload, callSignal) => {
      if (!client) throw new Error("Jev client was not prepared.");
      return client.judge(payload, callSignal);
    },
  }, signal);
}

export async function loadEvaluationCandidates(
  cardIds: string[],
  signal: AbortSignal,
): Promise<{ candidates: JevEvaluationCandidate[]; skipped: Array<{ card_id: string; reason: JevEvaluationSkipReason }> }> {
  const db = getDb();
  const candidates: JevEvaluationCandidate[] = [];
  const skipped: Array<{ card_id: string; reason: JevEvaluationSkipReason }> = [];
  const nodeCache = new Map<string, TreeNodeWithCard | null>();

  const readNode = async (nodeId: string): Promise<TreeNodeWithCard | null> => {
    if (signal.aborted) throw new EvaluationAbortedError();
    if (nodeCache.has(nodeId)) return nodeCache.get(nodeId) ?? null;
    const node = await getNode(nodeId);
    if (signal.aborted) throw new EvaluationAbortedError();
    nodeCache.set(nodeId, node);
    return node;
  };

  for (const cardId of cardIds) {
    if (signal.aborted) throw new EvaluationAbortedError();
    const card = await selectCardById(db, cardId);
    if (signal.aborted) throw new EvaluationAbortedError();
    if (!card) {
      skipped.push({ card_id: cardId, reason: "CARD_NOT_FOUND" });
      continue;
    }
    if (card.content === null || card.content.trim().length === 0) {
      skipped.push({ card_id: cardId, reason: "NO_BODY" });
      continue;
    }
    if (signal.aborted) throw new EvaluationAbortedError();
    const canonicalNodeId = await selectCanonicalEvaluationNodeId(db, cardId);
    if (signal.aborted) throw new EvaluationAbortedError();
    if (!canonicalNodeId) {
      skipped.push({ card_id: cardId, reason: await currentSkipReason(db, cardId, signal) });
      continue;
    }
    const node = await readNode(canonicalNodeId);
    if (!node) {
      skipped.push({ card_id: cardId, reason: await currentSkipReason(db, cardId, signal) });
      continue;
    }
    if (node.card.content === null || node.card.content.trim().length === 0) {
      skipped.push({ card_id: cardId, reason: "NO_BODY" });
      continue;
    }
    const ancestors: TreeNodeWithCard[] = [];
    const seen = new Set([node.id]);
    let parentId = node.parent_node_id;
    while (parentId && !seen.has(parentId)) {
      const parent = await readNode(parentId);
      if (!parent) break;
      seen.add(parentId);
      ancestors.unshift(parent);
      parentId = parent.parent_node_id;
    }
    const candidate = candidateFromNode(node, ancestors);
    if (candidate.summary === null) {
      skipped.push({ card_id: cardId, reason: "NO_BODY" });
      continue;
    }
    candidates.push({ ...candidate, cardVersion: node.card.version });
  }
  return { candidates, skipped };
}

function normalizeEvaluationInput(raw: JevEvaluationInput, policy: JevSearchPolicy): JevEvaluationInput & { query: string; context: JevSearchContext } {
  if (!raw || typeof raw !== "object" || typeof raw.query !== "string") {
    throw new JevEvaluationRequestError("A search query is required.", "JEV_QUERY_REQUIRED", 400);
  }
  const query = normalizeQuery(raw.query);
  if (query.length < 1 || query.length > 400) {
    throw new JevEvaluationRequestError("Jev query must be between 1 and 400 characters.", "JEV_QUERY_INVALID", 400);
  }

  let context: JevSearchContext;
  try {
    if (raw.context !== undefined && (!raw.context || typeof raw.context !== "object" || Array.isArray(raw.context))) throw new Error("invalid context");
    context = normalizeContext(raw.context);
  } catch {
    throw new JevEvaluationRequestError("Jev context fields must be text with at most 160 characters.", "JEV_CONTEXT_INVALID", 400);
  }

  if (!Array.isArray(raw.card_ids) || raw.card_ids.length < 1 || raw.card_ids.length > policy.batchCandidates
    || raw.card_ids.some(id => typeof id !== "string" || !UUID_PATTERN.test(id))
    || new Set(raw.card_ids).size !== raw.card_ids.length) {
    throw new JevEvaluationRequestError("Evaluation card_ids must contain 1 to 48 unique UUIDs.", "JEV_EVALUATION_IDS_INVALID", 400);
  }
  return { query, context, card_ids: [...raw.card_ids] };
}

function assertRunning(signal: AbortSignal, timedOut: boolean, evaluationId: string): void {
  if (!signal.aborted) return;
  if (timedOut) throw new JevEvaluationRequestError("Jev evaluation reached its time limit.", "JEV_EVALUATION_TIMEOUT", 504, evaluationId);
  throw new JevEvaluationRequestError("Jev evaluation was cancelled.", "JEV_EVALUATION_CANCELLED", 499, evaluationId);
}

function evaluationFailure(cause: unknown, timedOut: boolean, signal: AbortSignal): { code: string; message: string; statusCode: number } {
  if (timedOut) return { code: "JEV_EVALUATION_TIMEOUT", message: "Jev evaluation reached its time limit.", statusCode: 504 };
  if (signal.aborted) return { code: "JEV_EVALUATION_CANCELLED", message: "Jev evaluation was cancelled.", statusCode: 499 };
  if (cause instanceof JevAnswerError) return { code: "BAD_NOUL_RESPONSE", message: "Jev response did not include a valid score for every candidate.", statusCode: 502 };
  if (cause instanceof JevError) {
    const message = cause.code === "JEV_UPSTREAM_AUTH" ? "Jev authentication failed."
      : cause.code === "JEV_UPSTREAM_UNAVAILABLE" ? "Jev service is unavailable."
      : cause.code === "JEV_BAD_RESPONSE" ? "Jev returned an invalid response."
      : "Jev service returned an error.";
    return { code: cause.code, message, statusCode: 502 };
  }
  if (cause instanceof JevSearchConfigError) return { code: "JEV_NOT_CONFIGURED", message: "Jev evaluation is not configured.", statusCode: 503 };
  return { code: "JEV_EVALUATION_FAILED", message: "Jev evaluation failed.", statusCode: 500 };
}

class EvaluationAbortedError extends Error {}

async function currentSkipReason(db: ReturnType<typeof getDb>, cardId: string, signal: AbortSignal): Promise<JevEvaluationSkipReason> {
  if (signal.aborted) throw new EvaluationAbortedError();
  const current = await selectCardById(db, cardId);
  if (signal.aborted) throw new EvaluationAbortedError();
  if (!current) return "CARD_NOT_FOUND";
  if (current.content === null || current.content.trim().length === 0) return "NO_BODY";
  return "NO_CANONICAL_NODE";
}

function withAbort<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new EvaluationAbortedError());
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new EvaluationAbortedError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    pending.then(value => {
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    }, error => {
      signal.removeEventListener("abort", onAbort);
      reject(error);
    });
  });
}
