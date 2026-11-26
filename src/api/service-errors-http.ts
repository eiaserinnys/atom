import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { ServiceError } from "../services/service-errors.js";
import { invalidIdMessage, isUuid } from "../shared/uuid.js";

const PATH_ID_LABELS: Record<string, string> = {
  nodeId: "node_id",
  cardId: "card_id",
  id: "card_id",
};
const QUERY_ID_LABELS: Record<string, string> = {
  rootNodeId: "root_node_id",
  root_node_id: "root_node_id",
};
const BODY_ID_LABELS: Record<string, string> = {
  parent_node_id: "parent_node_id",
  card_id: "card_id",
  before: "before",
  after: "after",
};

function firstInvalidId(values: unknown, labels: Record<string, string>, optional: "null" | "empty" | "none"): string | null {
  if (!values || typeof values !== "object" || Array.isArray(values)) return null;
  for (const [key, label] of Object.entries(labels)) {
    const value = (values as Record<string, unknown>)[key];
    if (value === undefined || (optional === "null" && value === null) || (optional === "empty" && value === "")) continue;
    if (!isUuid(value)) return invalidIdMessage(label, value);
  }
  return null;
}

/**
 * Registers the shared REST error mapping for a route plugin:
 * ServiceError -> its status with `{ error: message }`, a non-UUID ID in the
 * path, query or body -> 400 (instead of a Postgres 22P02 500).
 */
export function registerServiceErrors(app: FastifyInstance): void {
  app.setErrorHandler((error, _req: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof ServiceError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    return reply.send(error);
  });

  app.addHook("preHandler", async (req, reply) => {
    const invalid = firstInvalidId(req.params, PATH_ID_LABELS, "none")
      ?? firstInvalidId(req.query, QUERY_ID_LABELS, "empty")
      ?? firstInvalidId(req.body, BODY_ID_LABELS, "null");
    if (invalid) return reply.code(400).send({ error: invalid });
  });
}
