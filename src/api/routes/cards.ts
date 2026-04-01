import type { FastifyInstance } from "fastify";
import {
  createCard,
  getCard,
  updateCard,
  deleteCard,
  getBacklinks,
} from "../../services/card.service.js";

export async function cardRoutes(app: FastifyInstance): Promise<void> {
  // GET /cards/:id
  app.get<{ Params: { id: string } }>("/cards/:id", async (req, reply) => {
    const card = await getCard(req.params.id);
    if (!card) return reply.code(404).send({ error: "Card not found" });
    return card;
  });

  // POST /cards
  app.post("/cards", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const { card, node_id } = await createCard({
      card_type: body["card_type"] as "structure" | "knowledge",
      title: body["title"] as string,
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
  });

  // PUT /cards/:id
  app.put<{ Params: { id: string } }>("/cards/:id", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const updated = await updateCard(req.params.id, {
      title: body["title"] as string | undefined,
      content: body["content"] as string | null | undefined,
      tags: body["tags"] as string[] | undefined,
      references: body["references"] as string[] | undefined,
      content_timestamp: body["content_timestamp"] as string | null | undefined,
      source_type: body["source_type"] as string | null | undefined,
      source_ref: body["source_ref"] as string | null | undefined,
    });
    if (!updated) return reply.code(404).send({ error: "Card not found" });
    return updated;
  });

  // DELETE /cards/:id
  app.delete<{ Params: { id: string } }>("/cards/:id", async (req, reply) => {
    const deleted = await deleteCard(req.params.id);
    if (!deleted) return reply.code(404).send({ error: "Card not found" });
    return reply.code(204).send();
  });

  // GET /backlinks/:cardId
  app.get<{ Params: { cardId: string } }>(
    "/backlinks/:cardId",
    async (req, reply) => {
      const links = await getBacklinks(req.params.cardId);
      return links;
    }
  );
}
