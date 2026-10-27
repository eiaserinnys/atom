import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SearchResult } from "../../src/shared/types.js";
import type { JevSearchResponse } from "../../src/shared/jev-search.js";
import { registerSearchTools, type SearchToolDependencies } from "../../src/mcp/tools/search_tools.js";

const bm25Result: SearchResult = {
  card_id: "card-1",
  node_id: "node-1",
  title: "지식 카드",
  card_type: "knowledge",
  is_symlink: false,
  snippet: "발췌",
  node_path: [],
};

const jevResponse = {
  schema_version: 2,
  engine: "jev",
  run_id: "run-1",
  query: "질의",
  root_node_id: null,
  exhaustive: false,
  status: "complete",
  complete: true,
  stop_reason: "exhausted",
  started_at: "2026-10-11T00:00:00.000Z",
  completed_at: "2026-10-11T00:00:01.000Z",
  policy: {
    prompt_version: "v3", model: "jev-latest", summary_chars: 200, structure_threshold: 0.5,
    score_floor: 0.3, relative_score_delta: 0.1, max_results: 6, batch_candidates: 48,
    payload_max_chars: 60_000, run_timeout_ms: 45_000, max_candidates: 20_000, max_concurrent_runs: 2,
    seed_limit: 24, seed_max_terms: 12, sufficiency_threshold: 0.7, max_jev_calls: 32, max_parallel_jev_calls: 3, defer_candidates: 96,
  },
  results: [],
  trace: {
    candidates: [],
    steps: [{
      id: "step-selection", seq: 1, hop: 0, stage: "selection", started_at: "2026-10-11T00:00:01.000Z",
      completed_at: "2026-10-11T00:00:01.000Z", call_id: null, candidate_refs: [], decisions: [], selection_threshold: 0.42,
    }],
    calls: [],
  },
  error: null,
} as JevSearchResponse;

function captureTool(dependencies: SearchToolDependencies) {
  let handler: ((...args: unknown[]) => Promise<unknown>) | undefined;
  const server = {
    tool: (_name: string, _description: string, _schema: unknown, callback: (...args: unknown[]) => Promise<unknown>) => { handler = callback; },
  } as unknown as McpServer;
  registerSearchTools(server, {
    ...dependencies,
    normalizeSearchRootNodeId: dependencies.normalizeSearchRootNodeId ?? (async rootNodeId => rootNodeId),
  });
  if (!handler) throw new Error("search_cards was not registered");
  return handler;
}

describe("search_cards Jev opt-in", () => {
  it("16 omits trace by default and returns the complete run summary", async () => {
    const handler = captureTool({ searchCards: async () => [bm25Result], runJev: async () => jevResponse });
    const reply = await handler({ query: "질의", engine: "jev" }, {}) as { content: Array<{ text: string }> };
    const compact = JSON.parse(reply.content[0].text);
    expect(compact).not.toHaveProperty("trace");
    expect(compact.summary).toEqual({ jev_calls: 0, input_tokens: 0, elapsed_ms: 1000, hops: 0, candidates: 0, selection_threshold: 0.42 });
    expect(compact.results).toEqual(jevResponse.results);
  });
  it("uses null when the run has no selection step", async () => {
    const handler = captureTool({ searchCards: async () => [bm25Result], runJev: async () => ({
      ...jevResponse,
      trace: { ...jevResponse.trace, steps: [] },
    }) });
    const reply = await handler({ query: "질의", engine: "jev" }, {}) as { content: Array<{ text: string }> };
    expect(JSON.parse(reply.content[0].text).summary.selection_threshold).toBeNull();
  });
  it("leaves the default BM25 result array intact", async () => {
    const handler = captureTool({ searchCards: async () => [bm25Result], runJev: async () => jevResponse });
    const response = await handler({ query: "질의" }, {});

    expect(response).toEqual({ content: [{ type: "text", text: JSON.stringify([bm25Result]) }] });
  });

  it("forwards context and MCP cancellation signal to the same Jev envelope", async () => {
    const controller = new AbortController();
    const calls: Array<{ input: unknown; signal: AbortSignal | undefined }> = [];
    const handler = captureTool({
      searchCards: async () => [bm25Result],
      runJev: async (input, signal) => { calls.push({ input, signal }); return jevResponse; },
    });
    const result = await handler({ query: "질의", engine: "jev", exhaustive: true, include_trace: true, limit: 3, root_node_id: "10000000-0000-4000-8000-000000000001", context: { agent: "roselin", project: "atom" } }, { signal: controller.signal });

    expect(calls).toHaveLength(1);
    expect(calls[0].input).toEqual({
        query: "질의",
        root_node_id: "10000000-0000-4000-8000-000000000001",
        limit: 3,
        exhaustive: true,
        context: { agent: "roselin", project: "atom", task: undefined },
    });
    expect(calls[0].signal).toBe(controller.signal);
    expect(result).toEqual({ content: [{ type: "text", text: JSON.stringify(jevResponse) }] });
    expect(JSON.parse((result as { content: Array<{ text: string }> }).content[0]!.text).trace.steps[0].selection_threshold).toBe(0.42);
  });

  it("rejects meaningless context on a BM25 call", async () => {
    const handler = captureTool({ searchCards: async () => [bm25Result], runJev: async () => jevResponse });
    const result = await handler({ query: "질의", context: { agent: "roselin" } }, {});

    expect(result).toMatchObject({ isError: true, content: [{ type: "text" }] });
    expect(JSON.parse((result as { content: Array<{ text: string }> }).content[0]!.text).error.code).toBe("JEV_CONTEXT_REQUIRES_JEV");
  });
});
