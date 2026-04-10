import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createCard, updateCard } from "../../services/card.service.js";
import { listChildren, compileSubtree } from "../../services/tree.service.js";
import { findActiveAgents } from "../../db/queries/agents.js";
import { getDb } from "../../db/client.js";
import bcrypt from "bcryptjs";
import type { Staleness, UpdateCardInput } from "../../shared/types.js";

async function agentKeyPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const secret = req.headers["x-api-key"] as string | undefined;
  if (!secret) {
    return reply.code(401).send({ error: "x-api-key header required" });
  }
  const agents = await findActiveAgents(getDb());
  const agent = (await Promise.all(
    agents.map(async (a) => (await bcrypt.compare(secret, a.secret_hash)) ? a : null)
  )).find(Boolean) ?? null;
  if (!agent) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
}

export async function cardApiRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/cards — create a card (agent key auth)
  app.post(
    "/api/cards",
    { preHandler: agentKeyPreHandler },
    async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      if (!body["title"] || typeof body["title"] !== "string") {
        return reply.code(400).send({ error: "title is required" });
      }
      const { card, node_id } = await createCard({
        card_type: (body["card_type"] as "structure" | "knowledge") ?? "knowledge",
        title: body["title"],
        content: (body["content"] as string | null) ?? null,
        parent_node_id: (body["parent_node_id"] as string | null) ?? null,
        position: body["position"] as number | undefined,
        tags: (body["tags"] as string[]) ?? [],
        references: (body["references"] as string[]) ?? [],
        content_timestamp: (body["content_timestamp"] as string | null) ?? null,
        source_type: (body["source_type"] as string | null) ?? null,
        source_ref: (body["source_ref"] as string | null) ?? null,
      });
      return reply.code(201).send({ ...card, node_id });
    }
  );

  // PATCH /api/cards/:cardId — update a card (agent key auth)
  app.patch<{ Params: { cardId: string } }>(
    "/api/cards/:cardId",
    { preHandler: agentKeyPreHandler },
    async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      const input: UpdateCardInput = {};

      if ("content" in body) input.content = body["content"] as string | null;
      if ("title" in body) input.title = body["title"] as string;
      if ("staleness" in body) input.staleness = body["staleness"] as Staleness;
      if ("tags" in body) input.tags = body["tags"] as string[];
      if ("source_ref" in body) input.source_ref = body["source_ref"] as string | null;

      const result = await updateCard(req.params.cardId, input);
      if (!result) return reply.code(404).send({ error: "Card not found" });
      if ("conflict" in result && result.conflict) {
        return reply.code(409).send({ error: "Version conflict", actualVersion: result.actualVersion });
      }
      return result.card;
    }
  );

  // GET /api/tree — list root nodes (agent key auth)
  app.get(
    "/api/tree",
    { preHandler: agentKeyPreHandler },
    async (_req, _reply) => {
      return listChildren(null);
    }
  );

  // GET /api/tree/:nodeId/children — list children of a node (agent key auth)
  app.get<{ Params: { nodeId: string } }>(
    "/api/tree/:nodeId/children",
    { preHandler: agentKeyPreHandler },
    async (req, reply) => {
      const children = await listChildren(req.params.nodeId);
      return children;
    }
  );

  // GET /api/tree/:nodeId/compile — compile subtree (agent key auth, query params)
  app.get<{ Params: { nodeId: string } }>(
    "/api/tree/:nodeId/compile",
    { preHandler: agentKeyPreHandler },
    async (req, reply) => {
      const qs = req.query as Record<string, string>;
      const depth = qs["depth"] !== undefined ? parseInt(qs["depth"]) : 2;
      const titlesOnly = qs["titles_only"] === "true";
      const includeIds = qs["include_ids"] === "true";
      const maxCharsRaw = qs["max_chars"] !== undefined ? parseInt(qs["max_chars"]) : undefined;
      const maxChars = maxCharsRaw !== undefined && !isNaN(maxCharsRaw) ? maxCharsRaw : undefined;
      const result = await compileSubtree(req.params.nodeId, depth, {
        titlesOnly: titlesOnly || undefined,
        includeIds: includeIds || undefined,
        maxChars,
      });
      return { markdown: result.markdown };
    }
  );

}
