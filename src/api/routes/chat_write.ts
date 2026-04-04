import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createCard, updateCard } from "../../services/card.service.js";
import type { Staleness, UpdateCardInput } from "../../shared/types.js";

const CHAT_WRITE_API_KEY = process.env["CHAT_WRITE_API_KEY"];

async function apiKeyPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!CHAT_WRITE_API_KEY) {
    return reply.code(503).send({ error: "CHAT_WRITE_API_KEY not configured" });
  }
  const provided = req.headers["x-api-key"];
  if (!provided || provided !== CHAT_WRITE_API_KEY) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
}

export async function chatWriteRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/chat/cards — create a chat log card
  app.post(
    "/api/chat/cards",
    { preHandler: apiKeyPreHandler },
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

  // PATCH /api/chat/cards/:cardId — update a chat log card
  app.patch<{ Params: { cardId: string } }>(
    "/api/chat/cards/:cardId",
    { preHandler: apiKeyPreHandler },
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
}
