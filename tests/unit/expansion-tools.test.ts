import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerExpansionTools, type ExpansionToolDependencies } from "../../src/mcp/tools/expansion_tools.js";
import type { CardNeighborsResponse } from "../../src/shared/embeddings.js";
import type { JevEvaluationResponse } from "../../src/shared/visual-search.js";
import { JevEvaluationRequestError } from "../../src/services/jev-search/evaluate.js";

const cardId = "10000000-0000-4000-8000-000000000001";

const readyNeighbors: CardNeighborsResponse = {
  status: "ready", model: "text-embedding-3-large", dimensions: 3072, key_configured: true,
  index: { indexed_cards: 2 },
  source: { card_id: cardId, node_id: "20000000-0000-4000-8000-000000000001", title: "출발 카드", card_type: "knowledge", path: [] },
  neighbors: [],
};

const evaluationResponse: JevEvaluationResponse = {
  evaluation_id: "30000000-0000-4000-8000-000000000001", query: "원래 질의", model: "jev-latest",
  results: [], skipped: [], audit: { calls: [{ call_id: "call", run_id: "run", seq: 1, stage: "content_noul", candidate_count: 1, disposition: "completed", started_at: "2026-10-26T00:00:00.000Z", completed_at: "2026-10-26T00:00:01.000Z", latency_ms: 1000, usage: { input_tokens: 10, output_tokens: 1 }, request: {}, response: {}, error: null }] },
};

function capture(dependencies: ExpansionToolDependencies) {
  const tools = new Map<string, { description: string; schema: Record<string, unknown>; handler: (...args: any[]) => Promise<unknown> }>();
  const server = { tool: (name: string, description: string, schema: Record<string, unknown>, handler: (...args: any[]) => Promise<unknown>) => tools.set(name, { description, schema, handler }) } as unknown as McpServer;
  registerExpansionTools(server, dependencies);
  return tools;
}

function decode(result: any): unknown {
  return JSON.parse(result.content[0].text);
}

describe("visual search MCP tools", () => {
  it("registers two bounded schemas and evaluate_cards documents the first search threshold", () => {
    const tools = capture({ neighbors: null, evaluate: async () => evaluationResponse });
    const neighbors = tools.get("get_card_neighbors")!;
    const evaluate = tools.get("evaluate_cards")!;

    expect(neighbors.schema).toHaveProperty("card_id");
    expect(neighbors.schema).toHaveProperty("limit");
    expect((neighbors.schema.card_id as any).safeParse(cardId).success).toBe(true);
    expect((neighbors.schema.card_id as any).safeParse("not-a-uuid").success).toBe(false);
    expect((neighbors.schema.limit as any).safeParse(1).success).toBe(true);
    expect((neighbors.schema.limit as any).safeParse(50).success).toBe(true);
    expect((neighbors.schema.limit as any).safeParse(0).success).toBe(false);
    expect((neighbors.schema.limit as any).safeParse(51).success).toBe(false);
    expect(evaluate.schema).toHaveProperty("query");
    expect(evaluate.schema).toHaveProperty("context");
    expect(evaluate.schema).toHaveProperty("card_ids");
    expect(evaluate.schema).not.toHaveProperty("threshold");
    expect(evaluate.schema).not.toHaveProperty("relevant");
    expect((evaluate.schema.card_ids as any).safeParse([cardId]).success).toBe(true);
    expect((evaluate.schema.card_ids as any).safeParse([]).success).toBe(false);
    expect((evaluate.schema.card_ids as any).safeParse(Array.from({ length: 49 }, () => cardId)).success).toBe(false);
    expect(evaluate.description).toContain("summary.selection_threshold");
    expect(evaluate.description).toContain("0.5");
  });

  it("preserves neighbor ready/loading/error bodies and passes the same card ID and limit", async () => {
    const calls: unknown[] = [];
    const tools = capture({
      neighbors: { get: async (id, limit) => { calls.push([id, limit]); return { statusCode: 200, body: readyNeighbors }; }, waitForLoad: async () => undefined },
      evaluate: async () => evaluationResponse,
    });
    const result = await tools.get("get_card_neighbors")!.handler({ card_id: cardId, limit: 12 }, {});
    expect(calls).toEqual([[cardId, 12]]);
    expect(decode(result)).toEqual(readyNeighbors);

    const loading = capture({
      neighbors: { get: async () => ({ statusCode: 202, body: { status: "loading", retry_after_ms: 1000 } }), waitForLoad: async () => undefined },
      evaluate: async () => evaluationResponse,
    });
    expect(decode(await loading.get("get_card_neighbors")!.handler({ card_id: cardId }, {}))).toEqual({ status: "loading", retry_after_ms: 1000 });

    const pending = capture({
      neighbors: { get: async () => ({ statusCode: 409, body: { error: { code: "EMBEDDING_NOT_READY", reason: "pending" }, key_configured: true } }), waitForLoad: async () => undefined },
      evaluate: async () => evaluationResponse,
    });
    const pendingResult = await pending.get("get_card_neighbors")!.handler({ card_id: cardId }, {});
    expect(pendingResult).toMatchObject({ isError: true });
    expect(decode(pendingResult)).toMatchObject({ error: { code: "EMBEDDING_NOT_READY", reason: "pending" }, key_configured: true });
  });

  it("makes stdio neighbor unavailability explicit and passes query, context, signal, and audit choice to evaluation", async () => {
    const controller = new AbortController();
    const calls: unknown[] = [];
    const tools = capture({
      neighbors: null,
      evaluate: async (input, signal) => { calls.push([input, signal]); return evaluationResponse; },
    });
    const unavailable = await tools.get("get_card_neighbors")!.handler({ card_id: cardId }, {});
    expect(unavailable).toMatchObject({ isError: true });
    expect(decode(unavailable)).toEqual({ error: { code: "NEIGHBORS_HTTP_ONLY", message: expect.any(String) } });

    const full = await tools.get("evaluate_cards")!.handler({ query: "원래 질의", context: { agent: "roselin" }, card_ids: [cardId], include_trace: true }, { signal: controller.signal });
    expect(calls).toEqual([[{ query: "원래 질의", context: { agent: "roselin" }, card_ids: [cardId] }, controller.signal]]);
    expect(decode(full)).toEqual(evaluationResponse);

    const compact = await tools.get("evaluate_cards")!.handler({ query: "원래 질의", card_ids: [cardId] }, {});
    expect(decode(compact)).toEqual({ ...evaluationResponse, audit: undefined });
  });

  it("returns only fixed busy errors and never serializes an exception message", async () => {
    const tools = capture({ neighbors: null, evaluate: async () => { throw new JevEvaluationRequestError("raw secret must not escape", "JEV_EVALUATION_BUSY", 429); } });
    const result = await tools.get("evaluate_cards")!.handler({ query: "질의", card_ids: [cardId] }, {});
    expect(result).toMatchObject({ isError: true });
    expect(decode(result)).toEqual({ error: { code: "JEV_EVALUATION_BUSY", message: expect.any(String) } });
    expect(JSON.stringify(result)).not.toContain("raw secret");
  });
});
