import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchCards } from "../../services/search.service.js";

export function registerSearchTools(server: McpServer): void {
  // search_cards
  server.tool(
    "search_cards",
    "Full-text search across card titles and content using PostgreSQL BM25 ranking (ts_rank). Returns cards sorted by relevance.\n\nQuery syntax (websearch_to_tsquery):\n- Plain text: 'quantum mechanics' → AND search\n- OR: 'quantum OR classical' → either keyword\n- Exact phrase: '\"quantum mechanics\"' → exact match\n- Exclude: 'quantum -classical' → exclude word\n\nEach result includes node_path: ancestor title array from root to parent (e.g. ['project', 'atom', 'TODO']). Empty array for orphan cards.",
    {
      query: z.string().describe("Search query. Natural language or tsquery syntax (e.g. 'design & principles')."),
      limit: z.number().int().optional().describe("Max results to return (default 20)."),
      root_node_id: z.string().uuid().optional().describe("Restrict search to this node's subtree."),
    },
    async ({ query, limit, root_node_id }) => {
      const results = await searchCards(query, limit ?? 20, root_node_id);
      return { content: [{ type: "text", text: JSON.stringify(results) }] };
    }
  );
}
