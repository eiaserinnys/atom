import type { FastifyInstance } from "fastify";
import { executeBatchWrite } from "../../services/batch.service.js";
import type { BatchWriteInput } from "../../shared/types.js";

export async function batchRoutes(app: FastifyInstance): Promise<void> {
  // POST /batch
  app.post("/batch", async (req, reply) => {
    const body = req.body as BatchWriteInput;
    const result = await executeBatchWrite(body);
    return reply.code(200).send(result);
  });
}
