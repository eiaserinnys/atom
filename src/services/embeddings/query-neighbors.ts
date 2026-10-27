import type { DatabaseAdapter } from "../../db/adapter.js";
import { getNeighborCardRows, getNeighborPathRows } from "../../db/queries/embedding-neighbors.js";
import { countIndexEmbeddings, listCurrentEligibleVersions, listIndexEmbeddings } from "../../db/queries/embeddings.js";
import { getOpenAIKeyForWorker } from "../../db/queries/openai-settings.js";
import type { EmbeddingErrorKind } from "../../shared/embeddings.js";
import type { QueryExpansionInput, QueryExpansionResponse } from "../../shared/query-expansion.js";
import { toOutlineExcerpt } from "../outline-excerpt.js";
import { EmbeddingClientError, requestEmbeddings } from "./client.js";
import { createEmbeddingInputFromText } from "./input.js";
import type { FlatEmbeddingIndex, StoredEmbedding } from "./flat-index.js";
import { EMBEDDING_POLICY } from "./policy.js";

export type QueryNeighborServiceResult =
  | { statusCode: 200; body: QueryExpansionResponse }
  | { statusCode: 202; body: { status: "loading"; retry_after_ms: 1000 } }
  | { statusCode: 409; body: { error: { code: "EMBEDDING_NOT_READY"; reason: "no_key" }; key_configured: false } }
  | { statusCode: 429; body: { error: { code: "OPENAI_RATE_LIMIT" } }; retryAfterMs: number | null }
  | { statusCode: 502; body: { error: { code: Exclude<EmbeddingErrorKind, "EMBEDDING_STORAGE"> } } }
  | { statusCode: 503; body: { error: { code: "INDEX_UNAVAILABLE" } } }
  | { statusCode: 504; body: { error: { code: "OPENAI_NETWORK" } } };

export interface QueryNeighborService {
  expand(input: QueryExpansionInput, signal: AbortSignal): Promise<QueryNeighborServiceResult>;
}

export interface QueryNeighborServiceOptions {
  db: DatabaseAdapter;
  index: FlatEmbeddingIndex;
  fetcher?: typeof fetch;
}

const DEFAULT_LIMIT = 12;
const LOADING_RESULT: QueryNeighborServiceResult = {
  statusCode: 202,
  body: { status: "loading", retry_after_ms: 1000 },
};

export function createQueryNeighborService({ db, index, fetcher = fetch }: QueryNeighborServiceOptions): QueryNeighborService {
  let loadFailed = false;

  async function* loadPages(): AsyncIterable<StoredEmbedding[]> {
    let afterId: string | null = null;
    for (;;) {
      const page = await listIndexEmbeddings(db, afterId);
      if (page.length === 0) return;
      yield page;
      afterId = page[page.length - 1].cardId;
      if (page.length < EMBEDDING_POLICY.indexPageSize) return;
    }
  }

  async function expand(input: QueryExpansionInput, signal: AbortSignal): Promise<QueryNeighborServiceResult> {
    if (index.status === "unloaded") {
      if (loadFailed) {
        loadFailed = false;
        return { statusCode: 503, body: { error: { code: "INDEX_UNAVAILABLE" } } };
      }
      void index.ensureLoaded(() => countIndexEmbeddings(db), loadPages)
        .then(() => { loadFailed = false; })
        .catch(() => { loadFailed = true; });
      return LOADING_RESULT;
    }
    if (index.status === "loading") return LOADING_RESULT;

    let apiKey: string | null;
    let currentVersions: Map<string, number>;
    try {
      [apiKey, currentVersions] = await Promise.all([
        getOpenAIKeyForWorker(db),
        listCurrentEligibleVersions(db),
      ]);
    } catch {
      return { statusCode: 503, body: { error: { code: "INDEX_UNAVAILABLE" } } };
    }
    if (apiKey === null) {
      return {
        statusCode: 409,
        body: { error: { code: "EMBEDDING_NOT_READY", reason: "no_key" }, key_configured: false },
      };
    }

    const embeddingInput = await createEmbeddingInputFromText(input.query);
    const controller = new AbortController();
    let timedOut = false;
    const abortForCaller = () => controller.abort(signal.reason);
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", abortForCaller, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, EMBEDDING_POLICY.requestTimeoutMs);

    let queryVector: Float32Array;
    try {
      const vectors = await requestEmbeddings(apiKey, [embeddingInput.inputTokens], controller.signal, fetcher);
      queryVector = new Float32Array(vectors[0]);
    } catch (error) {
      if (signal.aborted) throw error;
      if (timedOut) return { statusCode: 504, body: { error: { code: "OPENAI_NETWORK" } } };
      if (error instanceof EmbeddingClientError && error.kind === "OPENAI_RATE_LIMIT") {
        return { statusCode: 429, body: { error: { code: "OPENAI_RATE_LIMIT" } }, retryAfterMs: error.retryAfterMs };
      }
      const kind = error instanceof EmbeddingClientError ? error.kind : "OPENAI_NETWORK";
      return { statusCode: 502, body: { error: { code: kind as Exclude<EmbeddingErrorKind, "EMBEDDING_STORAGE"> } } };
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abortForCaller);
    }

    try {
      const excluded = new Set(input.exclude_card_ids);
      const eligibleVersions = new Map(
        [...currentVersions].filter(([cardId]) => !excluded.has(cardId))
      );
      const indexedCards = [...currentVersions].filter(([cardId, version]) =>
        index.versionOf(cardId) === version
      ).length;
      const scores = index.nearest(
        queryVector,
        null,
        eligibleVersions,
        input.limit ?? DEFAULT_LIMIT,
      );
      const cardIds = scores.map(row => row.cardId);
      const [cards, pathRows] = await Promise.all([
        getNeighborCardRows(db, cardIds),
        getNeighborPathRows(db, cardIds),
      ]);
      const cardById = new Map(cards.map(row => [row.card_id, row]));
      const paths = new Map<string, Array<{ node_id: string; title: string }>>();
      for (const row of pathRows) {
        const path = paths.get(row.card_id) ?? [];
        path.push({ node_id: row.node_id, title: row.title });
        paths.set(row.card_id, path);
      }
      const neighbors = scores.flatMap(score => {
        const row = cardById.get(score.cardId);
        const fullPath = paths.get(score.cardId);
        if (!row || !fullPath || fullPath.length === 0) return [];
        return [{
          card_id: score.cardId,
          node_id: row.node_id,
          card_type: row.card_type,
          title: row.title,
          similarity: Math.max(-1, Math.min(1, score.similarity)),
          excerpt: toOutlineExcerpt(row.content, EMBEDDING_POLICY.excerptMaxChars) ?? "",
          path: fullPath.slice(0, -1),
          tree_relation: null,
        }];
      });
      return {
        statusCode: 200,
        body: {
          status: "ready",
          model: EMBEDDING_POLICY.model,
          dimensions: EMBEDDING_POLICY.dimensions,
          key_configured: true,
          index: { indexed_cards: indexedCards },
          query: { text: embeddingInput.text, token_count: embeddingInput.tokenCount, truncated: embeddingInput.truncated },
          neighbors,
        },
      };
    } catch {
      return { statusCode: 503, body: { error: { code: "INDEX_UNAVAILABLE" } } };
    }
  }

  return { expand };
}
