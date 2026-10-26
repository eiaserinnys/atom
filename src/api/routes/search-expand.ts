import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { normalizeQuery } from "../../services/jev-search/prompts.js";
import type { QueryNeighborService } from "../../services/embeddings/query-neighbors.js";
import { EMBEDDING_POLICY } from "../../services/embeddings/policy.js";
import { requireRole } from "../config/policy.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_QUERY_CHARS = 400;
const DEFAULT_LIMIT = 12;

export function createSearchExpandRoutes(service: QueryNeighborService): FastifyPluginAsync {
  return async app => {
    app.setErrorHandler((error, _request, reply) => {
      const statusCode = error && typeof error === "object" && "statusCode" in error ? error.statusCode : undefined;
      if (statusCode === 400) {
        return reply.code(400).send({ error: { code: "QUERY_EXPANSION_INPUT_INVALID" } });
      }
      return reply.code(500).send({ error: { code: "INDEX_UNAVAILABLE" } });
    });

    app.post("/search/expand", async (request: FastifyRequest, reply) => {
      if (!requireRole(request, reply, "viewer")) return reply;

      const body = request.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return reply.code(400).send({ error: { code: "QUERY_EXPANSION_INPUT_INVALID" } });
      }
      const record = body as Record<string, unknown>;
      if (typeof record["query"] !== "string") {
        return reply.code(400).send({ error: { code: "QUERY_EXPANSION_INPUT_INVALID" } });
      }
      const query = normalizeQuery(record["query"]);
      if (query.length === 0 || query.length > MAX_QUERY_CHARS) {
        return reply.code(400).send({ error: { code: "QUERY_EXPANSION_INPUT_INVALID" } });
      }

      const rawExclusions = record["exclude_card_ids"];
      if (rawExclusions !== undefined && (!Array.isArray(rawExclusions) || rawExclusions.some(value => typeof value !== "string" || !UUID_PATTERN.test(value)))) {
        return reply.code(400).send({ error: { code: "QUERY_EXPANSION_INPUT_INVALID" } });
      }
      const excludeCardIds = [...new Set((rawExclusions ?? []) as string[])];

      const rawLimit = record["limit"];
      const limit = rawLimit === undefined ? DEFAULT_LIMIT : rawLimit;
      if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > EMBEDDING_POLICY.neighborsMaxLimit) {
        return reply.code(400).send({ error: { code: "NEIGHBOR_LIMIT_INVALID" } });
      }

      const controller = new AbortController();
      const onClose = () => {
        if (!reply.raw.writableEnded) controller.abort();
      };
      reply.raw.once("close", onClose);
      try {
        const result = await service.expand({ query, exclude_card_ids: excludeCardIds, limit }, controller.signal);
        if (result.statusCode === 202) reply.header("Retry-After", "1");
        if (result.statusCode === 429 && "retryAfterMs" in result && result.retryAfterMs !== null) {
          reply.header("Retry-After", String(Math.ceil(result.retryAfterMs / 1000)));
        }
        return reply.code(result.statusCode).send(result.body);
      } catch {
        if (controller.signal.aborted) return reply;
        return reply.code(503).send({ error: { code: "INDEX_UNAVAILABLE" } });
      } finally {
        reply.raw.removeListener("close", onClose);
      }
    });
  };
}
