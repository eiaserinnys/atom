import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { ServiceError } from "../services/service-errors.js";
import { invalidIdMessage, isUuid } from "../shared/uuid.js";

const PATH_ID_LABELS: Record<string, string> = {
  nodeId: "node_id",
  cardId: "card_id",
  id: "card_id",
};
const BODY_ID_LABELS: Record<string, string> = {
  parent_node_id: "parent_node_id",
  card_id: "card_id",
  before: "before",
  after: "after",
};

function firstInvalidId(values: unknown, labels: Record<string, string>, optional: "null" | "none"): string | null {
  if (!values || typeof values !== "object" || Array.isArray(values)) return null;
  for (const [key, label] of Object.entries(labels)) {
    const value = (values as Record<string, unknown>)[key];
    if (value === undefined || (optional === "null" && value === null)) continue;
    if (!isUuid(value)) return invalidIdMessage(label, value);
  }
  return null;
}

/**
 * 400 for a non-UUID ID in the path or body (instead of a Postgres 22P02 500).
 * Search `root_node_id` is checked by the search service, which knows its error shape.
 * Runs only for authenticated requests: routes behind the agent key put it
 * after their key check, so an unauthenticated request is always 401 first.
 */
export async function validateRequestIds(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const invalid = firstInvalidId(req.params, PATH_ID_LABELS, "none")
    ?? firstInvalidId(req.body, BODY_ID_LABELS, "null");
  if (invalid) return reply.code(400).send({ error: invalid, code: "INVALID_ID" });
}

/**
 * Registers the shared REST error mapping for a route plugin:
 * ServiceError -> its status with `{ error: message, code }`, and the ID check for
 * requests already authenticated by the dashboard auth hook (`req.jwtUser`).
 */
export function registerServiceErrors(app: FastifyInstance): void {
  app.setErrorHandler((error, _req: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof ServiceError) {
      return reply.code(error.statusCode).send({ error: error.message, code: error.code });
    }
    return reply.send(error);
  });

  app.addHook("preHandler", async (req, reply) => {
    if (req.jwtUser) return validateRequestIds(req, reply);
  });
}
