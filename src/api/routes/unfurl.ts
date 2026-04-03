import type { FastifyInstance } from "fastify";
import { adapterRegistry } from "../../unfurl/registry.js";

export async function unfurlRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/unfurl/adapters — list registered adapters and their credential fields
  app.get("/api/unfurl/adapters", async (_req, _reply) => {
    return { adapters: adapterRegistry.list() };
  });
}
