import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchCards } from "../../services/search.service.js";

export function registerSearchTools(server: McpServer): void {
  // search_cards
  server.tool(
    "search_cards",
    "BM25 full-text search on title, content, and tags. Sorted by ts_rank.",
    {
      query: z.string(),
      limit: z.number().int().optional(),
    },
    async ({ query, limit }) => {
      const results = await searchCards(query, limit ?? 20);
      return { content: [{ type: "text", text: JSON.stringify(results) }] };
    }
  );
}
