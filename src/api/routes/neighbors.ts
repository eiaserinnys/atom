import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { NeighborService } from "../../services/embeddings/neighbors.js";
import { agentKeyPreHandler } from "../agent-key-auth.js";
import { EMBEDDING_POLICY } from "../../services/embeddings/policy.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createNeighborsRoutes(service: NeighborService): FastifyPluginAsync {
  return async app => {
    const handler = async (request: FastifyRequest<{ Params: { cardId: string }; Querystring: { limit?: string } }>, reply: FastifyReply) => {
      const cardId = request.params.cardId;
      if (!UUID_PATTERN.test(cardId)) return reply.code(400).send({ error: { code: "CARD_ID_INVALID" } });
      const rawLimit = request.query.limit;
      const limit = rawLimit === undefined ? EMBEDDING_POLICY.neighborsDefaultLimit : Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > EMBEDDING_POLICY.neighborsMaxLimit) {
        return reply.code(400).send({ error: { code: "NEIGHBOR_LIMIT_INVALID" } });
      }
      try {
        const result = await service.get(cardId, limit);
        if (result.statusCode === 202) reply.header("Retry-After", "1");
        return reply.code(result.statusCode).send(result.body);
      } catch {
        return reply.code(503).send({ error: { code: "INDEX_UNAVAILABLE" } });
      }
    };

    app.get<{ Params: { cardId: string }; Querystring: { limit?: string } }>(
      "/cards/:cardId/neighbors",
      handler,
    );
    app.get<{ Params: { cardId: string }; Querystring: { limit?: string } }>(
      "/api/cards/:cardId/neighbors",
      { preHandler: agentKeyPreHandler },
      handler,
    );
  };
}
