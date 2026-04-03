import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchCards } from "../../services/search.service.js";

export function registerSearchTools(server: McpServer): void {
  // search_cards
  server.tool(
    "search_cards",
    "Full-text search across card titles, content, and tags using PostgreSQL BM25 ranking (ts_rank). Returns cards sorted by relevance. Supports natural language queries and PostgreSQL tsquery operators (& for AND, | for OR).",
    {
      query: z.string().describe("Search query. Natural language or tsquery syntax (e.g. 'design & principles')."),
      limit: z.number().int().optional().describe("Max results to return (default 20)."),
    },
    async ({ query, limit }) => {
      const results = await searchCards(query, limit ?? 20);
      return { content: [{ type: "text", text: JSON.stringify(results) }] };
    }
  );
}
