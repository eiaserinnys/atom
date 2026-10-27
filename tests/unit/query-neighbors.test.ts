import { jest } from "@jest/globals";
import type { DatabaseAdapter } from "../../src/db/adapter.js";
import { serializeEmbedding } from "../../src/services/embeddings/binary.js";
import { FlatEmbeddingIndex } from "../../src/services/embeddings/flat-index.js";
import { createEmbeddingInputFromText } from "../../src/services/embeddings/input.js";
import { EMBEDDING_POLICY } from "../../src/services/embeddings/policy.js";
import type { QueryExpansionResponse } from "../../src/shared/query-expansion.js";

const ids = {
  excluded: "10000000-0000-4000-8000-000000000001",
  visible: "10000000-0000-4000-8000-000000000002",
  stale: "10000000-0000-4000-8000-000000000003",
};

const neighborRows: {
  cards: Array<Record<string, unknown>>;
  paths: Array<Record<string, unknown>>;
  cardIds: string[];
} = { cards: [], paths: [], cardIds: [] };

await jest.unstable_mockModule("../../src/db/queries/embedding-neighbors.js", () => ({
  getNeighborCardRows: async (_db: unknown, cardIds: string[]) => {
    neighborRows.cardIds = cardIds;
    return neighborRows.cards;
  },
  getNeighborPathRows: async (_db: unknown, cardIds: string[]) => {
    neighborRows.cardIds = cardIds;
    return neighborRows.paths;
  },
}));

const { createQueryNeighborService } = await import("../../src/services/embeddings/query-neighbors.js");

function vector(first: number): Float32Array {
  const values = new Float32Array(EMBEDDING_POLICY.dimensions);
  values[0] = first;
  return values;
}

function queryResult(rows: unknown[] = []) {
  return { rows, rowCount: rows.length, command: "", oid: 0, fields: [] } as never;
}

function fakeDb(options: { key?: string | null; versions?: Array<{ card_id: string; version: number }>; pages?: unknown[] } = {}) {
  const key = options.key === undefined ? "test-only-openai-key" : options.key;
  const versions = options.versions ?? [
    { card_id: ids.excluded, version: 1 },
    { card_id: ids.visible, version: 1 },
    { card_id: ids.stale, version: 2 },
  ];
  const pages = options.pages ?? [];
  const calls: string[] = [];
  const db = {
    dbType: "sqlite" as const,
    async query(sql: string) {
      calls.push(sql);
      if (sql.includes("SELECT openai_api_key FROM app_settings")) return queryResult(key === null ? [] : [{ openai_api_key: key }]);
      if (sql.includes("SELECT c.id AS card_id, c.version")) return queryResult(versions);
      if (sql.includes("SELECT COUNT(*) AS count")) return queryResult([{ count: String(pages.length) }]);
      if (sql.includes("SELECT e.card_id, e.card_version, e.embedding")) return queryResult(pages);
      throw new Error("unexpected query");
    },
    async transaction<T>(fn: (client: never) => Promise<T>) { return fn(db as never); },
    async close() {},
    async runMigrations() {},
  } as DatabaseAdapter;
  return { db, calls };
}

function readyIndex(): FlatEmbeddingIndex {
  const index = new FlatEmbeddingIndex();
  index.loadRows([
    { cardId: ids.excluded, version: 1, embedding: serializeEmbedding(vector(0.99)) },
    { cardId: ids.visible, version: 1, embedding: serializeEmbedding(vector(0.98)) },
    { cardId: ids.stale, version: 1, embedding: serializeEmbedding(vector(0.97)) },
  ]);
  return index;
}

function embeddingResponse() {
  return new Response(JSON.stringify({ data: [{ index: 0, embedding: Array.from(vector(1)) }] }), { status: 200 });
}

describe("query neighbor service", () => {
  beforeEach(() => {
    neighborRows.cards = [];
    neighborRows.paths = [];
    neighborRows.cardIds = [];
  });

  it("embeds the normalized query and applies exclusions before top-K, returning V6 metadata", async () => {
    const { db } = fakeDb();
    neighborRows.cards = [{
      card_id: ids.visible,
      node_id: "20000000-0000-4000-8000-000000000002",
      card_type: "knowledge",
      title: "Visible candidate",
      content: "A body with **markdown**.",
      version: 1,
    }];
    neighborRows.paths = [
      { card_id: ids.visible, node_id: "30000000-0000-4000-8000-000000000003", title: "Parent", hops: 1 },
      { card_id: ids.visible, node_id: "20000000-0000-4000-8000-000000000002", title: "Visible candidate", hops: 0 },
    ];
    let sentBody = "";
    const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
      sentBody = String(init?.body ?? "");
      return embeddingResponse();
    }) as typeof fetch;
    const service = createQueryNeighborService({ db, index: readyIndex(), fetcher });
    const result = await service.expand({ query: "normalized query", exclude_card_ids: [ids.excluded], limit: 1 }, new AbortController().signal);

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(sentBody).input).toEqual([(await createEmbeddingInputFromText("normalized query")).inputTokens]);
    expect(neighborRows.cardIds).toEqual([ids.visible]);
    expect(result.body).toMatchObject({
      status: "ready",
      key_configured: true,
      index: { indexed_cards: 2 },
      query: { text: "normalized query", truncated: false },
      neighbors: [{
        card_id: ids.visible,
        node_id: "20000000-0000-4000-8000-000000000002",
        card_type: "knowledge",
        title: "Visible candidate",
        excerpt: "A body with markdown .",
        path: [{ node_id: "30000000-0000-4000-8000-000000000003", title: "Parent" }],
        tree_relation: null,
      }],
    });
    await expect((result.body as QueryExpansionResponse).neighbors[0]?.similarity).toBeCloseTo(0.98);
  });

  it("returns loading before any OpenAI call, then reports no_key without calling OpenAI", async () => {
    const row = { cardId: ids.visible, version: 1, embedding: serializeEmbedding(vector(0.8)) };
    const { db, calls } = fakeDb({ key: null, versions: [{ card_id: ids.visible, version: 1 }], pages: [row] });
    const fetcher = jest.fn(async () => embeddingResponse()) as unknown as typeof fetch;
    const index = new FlatEmbeddingIndex();
    const service = createQueryNeighborService({ db, index, fetcher });

    const loading = await service.expand({ query: "query", exclude_card_ids: [] }, new AbortController().signal);
    expect(loading).toEqual({ statusCode: 202, body: { status: "loading", retry_after_ms: 1000 } });
    expect(fetcher).not.toHaveBeenCalled();
    await index.waitForLoad();

    const notReady = await service.expand({ query: "query", exclude_card_ids: [] }, new AbortController().signal);
    expect(notReady).toEqual({
      statusCode: 409,
      body: { error: { code: "EMBEDDING_NOT_READY", reason: "no_key" }, key_configured: false },
    });
    expect(calls.some(sql => sql.includes("SELECT openai_api_key FROM app_settings"))).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns only sanitized upstream errors and maps its request timeout to 504", async () => {
    const { db } = fakeDb();
    const networkFailure = createQueryNeighborService({
      db,
      index: readyIndex(),
      fetcher: (async () => { throw new Error("secret upstream detail"); }) as typeof fetch,
    });
    const failed = await networkFailure.expand({ query: "query", exclude_card_ids: [] }, new AbortController().signal);
    expect(failed).toEqual({ statusCode: 502, body: { error: { code: "OPENAI_NETWORK" } } });
    expect(JSON.stringify(failed).includes("secret upstream detail")).toBe(false);

    jest.useFakeTimers();
    try {
      let requestSignal: AbortSignal | undefined;
      const timeoutService = createQueryNeighborService({
        db,
        index: readyIndex(),
        fetcher: ((_url: string | URL | Request, init?: RequestInit) => {
          requestSignal = init?.signal as AbortSignal;
          return new Promise<Response>((_resolve, reject) => {
            requestSignal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          });
        }) as typeof fetch,
      });
      const pending = timeoutService.expand({ query: "query", exclude_card_ids: [] }, new AbortController().signal);
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(EMBEDDING_POLICY.requestTimeoutMs);
      const timedOut = await pending;
      expect(requestSignal?.aborted).toBe(true);
      expect(timedOut).toEqual({ statusCode: 504, body: { error: { code: "OPENAI_NETWORK" } } });
    } finally {
      jest.useRealTimers();
    }
  });
});
