import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchCards } from "../../services/search.service.js";

export function registerSearchTools(server: McpServer): void {
  // search_cards
  server.tool(
    "search_cards",
    "Full-text search across card titles and content using PostgreSQL BM25 ranking (ts_rank). Returns cards sorted by relevance.\n\nQuery syntax (websearch_to_tsquery):\n- Plain text: 'quantum mechanics' → AND search\n- OR: 'quantum OR classical' → either keyword\n- Exact phrase: '\"quantum mechanics\"' → exact match\n- Exclude: 'quantum -classical' → exclude word\n\nFilters (all optional, AND-combined with query):\n- tags: cards containing ALL specified tags\n- card_type: 'structure' or 'knowledge'\n- updated_after/updated_before: ISO 8601 timestamp range on updated_at\n- source_type: exact match (e.g. 'trello', 'github')\n\nEach result includes node_path: ancestor title array from root to parent (e.g. ['project', 'atom', 'TODO']). Empty array for orphan cards.",
    {
      query: z.string().min(1).describe("Search query (required, non-empty). Natural language or tsquery syntax."),
      limit: z.number().int().positive().optional().describe("Max results to return (default 20)."),
      root_node_id: z.string().uuid().optional().describe("Restrict search to this node's subtree."),
      tags: z.array(z.string().min(1)).optional().describe("Filter: cards containing ALL specified tags."),
      card_type: z.enum(["structure", "knowledge"]).optional().describe("Filter: card type."),
      updated_after: z.string().datetime({ offset: true }).optional().describe("Filter: updated_at >= this ISO 8601 timestamp."),
      updated_before: z.string().datetime({ offset: true }).optional().describe("Filter: updated_at <= this ISO 8601 timestamp."),
      source_type: z.string().min(1).optional().describe("Filter: exact source_type match (e.g. 'trello', 'github')."),
    },
    async (filters) => {
      const results = await searchCards(filters);
      return { content: [{ type: "text", text: JSON.stringify(results) }] };
    }
  );
}
