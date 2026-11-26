import type { FastifyInstance } from "fastify";
import {
  createCard,
  getCard,
  updateCard,
  deleteCard,
  getBacklinks,
} from "../../services/card.service.js";
import { cardNotFound, versionConflictMessage } from "../../services/service-errors.js";
import { registerServiceErrors } from "../service-errors-http.js";
import { parseCreateCardBody } from "./card-body.js";

export async function cardRoutes(app: FastifyInstance): Promise<void> {
  registerServiceErrors(app);

  // GET /cards/:id
  app.get<{ Params: { id: string } }>("/cards/:id", async (req, reply) => {
    const card = await getCard(req.params.id);
    if (!card) throw await cardNotFound(req.params.id);
    return card;
  });

  // POST /cards
  app.post("/cards", async (req, reply) => {
    const { card, node_id } = await createCard(parseCreateCardBody(req.body));
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
    }, body["expected_version"] as number | undefined);
    if (!updated) throw await cardNotFound(req.params.id);
    if (updated.conflict) {
      return reply.code(409).send({
        error: "VERSION_CONFLICT",
        code: "VERSION_CONFLICT",
        current_version: updated.actualVersion,
        message: versionConflictMessage(req.params.id, body["expected_version"] as number | undefined, updated.actualVersion),
      });
    }
    return updated;
  });

  // DELETE /cards/:id
  app.delete<{ Params: { id: string } }>("/cards/:id", async (req, reply) => {
    if (!(await deleteCard(req.params.id))) throw await cardNotFound(req.params.id);
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
