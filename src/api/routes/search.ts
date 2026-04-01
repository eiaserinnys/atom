import type { FastifyInstance } from "fastify";
import { searchCards } from "../../services/search.service.js";

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  // GET /search?q=...
  app.get("/search", async (req, reply) => {
    const qs = req.query as Record<string, string>;
    if (!qs["q"]) return reply.code(400).send({ error: "q parameter required" });
    const results = await searchCards(qs["q"], qs["limit"] ? parseInt(qs["limit"]) : 20);
    return results;
  });
}
