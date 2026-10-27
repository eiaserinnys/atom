import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SearchQueryInputError } from "../../db/queries/search.js";
import { normalizeSearchRootNodeId, searchCards } from "../../services/search.service.js";
import { runConfiguredJevSearch } from "../../services/jev-search/service.js";
import { JevSearchRequestError } from "../../services/jev-search/config.js";
import type { JevSearchCompactResponse, JevSearchInput, JevSearchResponse } from "../../shared/jev-search.js";
import type { SearchFilters, SearchResult } from "../../shared/types.js";

export interface SearchToolDependencies {
  searchCards(filters: SearchFilters): Promise<SearchResult[]>;
  runJev(input: JevSearchInput, signal?: AbortSignal): Promise<JevSearchResponse>;
  normalizeSearchRootNodeId?(rootNodeId: string | null | undefined): Promise<string | null | undefined>;
}

export function registerSearchTools(server: McpServer, overrides: Partial<SearchToolDependencies> = {}): void {
  const deps: SearchToolDependencies = {
    searchCards,
    runJev: runConfiguredJevSearch,
    normalizeSearchRootNodeId,
    ...overrides,
  };

  server.tool(
    "search_cards",
    "Full-text search across card titles and content using PostgreSQL BM25 ranking (ts_rank). Returns cards sorted by relevance. Set engine='jev' to opt into Jev structure and content judging. Jev returns a compact run summary by default; include_trace=true adds the full trace.\n\nQuery syntax (websearch_to_tsquery):\n- Plain text: 'quantum mechanics' → AND search\n- OR: 'quantum OR classical' → either keyword\n- Exact phrase: '\"quantum mechanics\"' → exact match\n- Exclude: 'quantum -classical' → exclude word\n\nDefault strategy: auto. If a long plain-language query has 4+ searchable terms and strict BM25 returns 0 rows, the service retries once with an OR query built from those terms. Explicit OR/AND, phrase, and exclude queries stay strict. Use strategy='strict' to disable the fallback.\n\nFilters (all optional, AND-combined with query):\n- tags: cards containing ALL specified tags\n- card_type: 'structure' or 'knowledge'\n- updated_after/updated_before: ISO 8601 timestamp range on updated_at\n- source_type: exact match (e.g. 'trello', 'github')\n\nEach result includes node_path: ancestor title array from root to parent (e.g. ['project', 'atom', 'TODO']). Empty array for orphan cards. Jev accepts query, root_node_id, limit, context, exhaustive, and include_trace; it does not use BM25 filters. After a Jev search, call get_card_neighbors for a selected card and evaluate_cards for the original query and returned card IDs.",
    {
      query: z.string().min(1).describe("Search query (required, non-empty). Natural language or tsquery syntax."),
      limit: z.number().int().positive().optional().describe("Max results to return (default 20 for BM25, 6 for Jev)."),
      root_node_id: z.string().uuid().optional().describe("Restrict search to this node's subtree."),
      tags: z.array(z.string().min(1)).optional().describe("Filter: cards containing ALL specified tags."),
      card_type: z.enum(["structure", "knowledge"]).optional().describe("Filter: card type."),
      updated_after: z.string().datetime({ offset: true }).optional().describe("Filter: updated_at >= this ISO 8601 timestamp."),
      updated_before: z.string().datetime({ offset: true }).optional().describe("Filter: updated_at <= this ISO 8601 timestamp."),
      source_type: z.string().min(1).optional().describe("Filter: exact source_type match (e.g. 'trello', 'github')."),
      strategy: z.enum(["auto", "strict"]).optional().describe("Search strategy. auto (default) retries long plain queries as OR only when strict returns 0; strict disables fallback."),
      engine: z.enum(["bm25", "jev"]).optional().describe("Search engine. Jev returns schema version 2 results and a summary; omit for the existing BM25 result array."),
      exhaustive: z.boolean().optional().describe("Jev-only: record sufficiency but continue until exhaustion or a run limit."),
      include_trace: z.boolean().optional().describe("Jev-only: include the full trace; default returns results and a compact run summary."),
      context: z.object({
        agent: z.string().max(160).optional(),
        project: z.string().max(160).optional(),
        task: z.string().max(160).optional(),
      }).optional().describe("Jev-only optional relevance context."),
    },
    async (filters, extra) => {
      const { engine, context, exhaustive, include_trace, ...searchFilters } = filters;
      if (engine !== "jev") {
        if (context !== undefined) return toolError("JEV_CONTEXT_REQUIRES_JEV", "Context fields require engine=jev.");
        if (exhaustive !== undefined || include_trace !== undefined) return toolError("JEV_OPTIONS_REQUIRE_JEV", "Jev options require engine=jev.");
        try {
          const results = await deps.searchCards(searchFilters);
          return { content: [{ type: "text", text: JSON.stringify(results) }] };
        } catch (error) {
          if (error instanceof SearchQueryInputError) return toolError(error.code, error.message);
          throw error;
        }
      }

      const unsupported = ["tags", "card_type", "updated_after", "updated_before", "source_type", "strategy"];
      if (unsupported.some((key) => searchFilters[key as keyof typeof searchFilters] !== undefined)) {
        return toolError("JEV_UNSUPPORTED_FILTER", "Jev search does not support BM25 filters.");
      }
      const input: JevSearchInput = {
        query: filters.query,
        root_node_id: (await (deps.normalizeSearchRootNodeId ?? normalizeSearchRootNodeId)(filters.root_node_id)) ?? null,
        limit: filters.limit,
        exhaustive,
        context: {
          agent: context?.agent,
          project: context?.project,
          task: context?.task,
        },
      };
      try {
        const result = await deps.runJev(input, extra.signal);
        return {
          content: [{ type: "text", text: JSON.stringify(include_trace ? result : compactResponse(result)) }],
          ...(result.status === "error" ? { isError: true } : {}),
        };
      } catch (error) {
        if (error instanceof JevSearchRequestError) return toolError(error.code, error.message);
        return toolError("JEV_SEARCH_FAILED", "Jev search failed.");
      }
    },
  );
}

function compactResponse(response: JevSearchResponse): JevSearchCompactResponse {
  const { trace, ...run } = response;
  const jevCalls = trace.calls.filter(call => ["structure_noul", "content_noul", "sufficiency_noul"].includes(call.stage));
  const steps = trace.steps.filter(step => !["selection", "run_terminal"].includes(step.stage));
  const selectionThreshold = trace.steps.filter(step => step.stage === "selection").at(-1)?.selection_threshold ?? null;
  return { ...run, summary: {
    jev_calls: jevCalls.length,
    input_tokens: jevCalls.reduce((sum, call) => sum + (call.usage?.input_tokens ?? 0), 0),
    elapsed_ms: Math.max(0, Date.parse(run.completed_at) - Date.parse(run.started_at)),
    hops: Math.max(0, ...steps.map(step => step.hop)),
    candidates: trace.candidates.length,
    selection_threshold: selectionThreshold,
  } };
}

function toolError(code: string, message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message } }) }],
  };
}
