import type { FastifyInstance } from "fastify";
import { executeBatchOp } from "../../services/batch.service.js";
import type { BatchOpInput } from "../../shared/types.js";
import { registerServiceErrors } from "../service-errors-http.js";

export async function batchRoutes(app: FastifyInstance): Promise<void> {
  registerServiceErrors(app);

  // POST /batch
  app.post("/batch", async (req, reply) => {
    const body = req.body as BatchOpInput;
    const result = await executeBatchOp(body);
    return reply.code(200).send(result);
  });
}
