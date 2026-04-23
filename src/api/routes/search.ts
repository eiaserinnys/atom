import type { FastifyInstance } from "fastify";
import { searchCards } from "../../services/search.service.js";
import type { SearchFilters, CardType } from "../../shared/types.js";

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  // GET /search?q=...&tags=a,b&card_type=knowledge&updated_after=...&updated_before=...&source_type=...
  app.get("/search", async (req, reply) => {
    const qs = req.query as Record<string, string>;
    if (!qs["q"]) return reply.code(400).send({ error: "q parameter required" });

    // Validate limit
    let limit: number | undefined;
    if (qs["limit"]) {
      limit = parseInt(qs["limit"], 10);
      if (isNaN(limit) || limit <= 0) {
        return reply.code(400).send({ error: "limit must be a positive integer" });
      }
    }

    // Validate card_type
    const validCardTypes: CardType[] = ["structure", "knowledge"];
    if (qs["card_type"] && !validCardTypes.includes(qs["card_type"] as CardType)) {
      return reply.code(400).send({ error: `card_type must be one of: ${validCardTypes.join(", ")}` });
    }

    // Validate ISO 8601 timestamps
    if (qs["updated_after"] && isNaN(Date.parse(qs["updated_after"]))) {
      return reply.code(400).send({ error: "updated_after must be a valid ISO 8601 timestamp" });
    }
    if (qs["updated_before"] && isNaN(Date.parse(qs["updated_before"]))) {
      return reply.code(400).send({ error: "updated_before must be a valid ISO 8601 timestamp" });
    }

    // Parse tags: trim whitespace, drop empty strings
    const rawTags = qs["tags"]?.split(",").map((t) => t.trim()).filter(Boolean);

    const filters: SearchFilters = {
      query: qs["q"],
      limit,
      root_node_id: qs["rootNodeId"] || undefined,
      tags: rawTags?.length ? rawTags : undefined,
      card_type: qs["card_type"] as CardType | undefined,
      updated_after: qs["updated_after"] || undefined,
      updated_before: qs["updated_before"] || undefined,
      source_type: qs["source_type"] || undefined,
    };

    const results = await searchCards(filters);
    return results;
  });
}
