import type { FastifyReply, FastifyRequest } from "fastify";
import type { TreeOutline } from "../../shared/types.js";

/**
 * GET /api/tree/outline (agent key) and GET /tree/outline (dashboard JWT)
 * share this handler: a body-free structural outline of a subtree.
 *
 * Query:
 *   node_id  UUID, omitted = virtual root (parent_node_id IS NULL)
 *   depth    1..3, default 2 — how many levels `children` is filled
 */
const OUTLINE_DEFAULT_DEPTH = 2;
const DEPTH_PATTERN = /^[1-3]$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TreeOutlineQueryParseResult =
  | { ok: true; nodeId: string | null; depth: number }
  | { ok: false; error: string };

export function parseTreeOutlineQuery(query: unknown): TreeOutlineQueryParseResult {
  const qs = (query ?? {}) as Record<string, unknown>;

  const rawNodeId = qs["node_id"];
  let nodeId: string | null = null;
  if (rawNodeId !== undefined) {
    if (typeof rawNodeId !== "string" || !UUID_PATTERN.test(rawNodeId)) {
      return { ok: false, error: "node_id must be a single UUID" };
    }
    nodeId = rawNodeId;
  }

  const rawDepth = qs["depth"];
  let depth = OUTLINE_DEFAULT_DEPTH;
  if (rawDepth !== undefined) {
    if (typeof rawDepth !== "string" || !DEPTH_PATTERN.test(rawDepth)) {
      return { ok: false, error: "depth must be an integer between 1 and 3" };
    }
    depth = Number(rawDepth);
  }

  return { ok: true, nodeId, depth };
}

export interface TreeOutlineHandlerDeps {
  getTreeOutline(nodeId: string | null, depth: number): Promise<TreeOutline | null>;
}

export function createTreeOutlineHandler(deps: TreeOutlineHandlerDeps) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = parseTreeOutlineQuery(req.query);
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.error });
    }
    const outline = await deps.getTreeOutline(parsed.nodeId, parsed.depth);
    if (!outline) {
      return reply.code(404).send({ error: "Node not found" });
    }
    return outline;
  };
}
