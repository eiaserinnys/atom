import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createCard, updateCard } from "../../services/card.service.js";
import { listChildren, compileSubtree, getTreeOutline } from "../../services/tree.service.js";
import { agentKeyPreHandler, requireAgentWriteScope } from "../agent-key-auth.js";
import type { UpdateCardInput } from "../../shared/types.js";
import { parseCompileLimit } from "./compile-limit.js";
import { createTreeOutlineHandler } from "./tree-outline.js";
import { parseCreateCardBody } from "./card-body.js";
import { cardNotFound, versionConflictMessage } from "../../services/service-errors.js";
import { registerServiceErrors } from "../service-errors-http.js";

interface AgentCompileHandlerDeps {
  compileSubtree: typeof compileSubtree;
}

export function createAgentCompileHandler(deps: AgentCompileHandlerDeps) {
  return async (
    req: FastifyRequest<{ Params: { nodeId: string } }>,
    reply: FastifyReply
  ) => {
    const qs = req.query as Record<string, string>;
    const parsedLimit = parseCompileLimit(qs["limit"]);
    if (!parsedLimit.ok) {
      return reply.code(400).send({ error: parsedLimit.error });
    }

    const depth = qs["depth"] !== undefined ? parseInt(qs["depth"]) : 2;
    const titlesOnly = qs["titles_only"] === "true";
    const includeIds: boolean | undefined =
      qs["include_ids"] === undefined ? undefined : qs["include_ids"] === "true";
    const maxCharsRaw = qs["max_chars"] !== undefined ? parseInt(qs["max_chars"]) : undefined;
    const maxChars = maxCharsRaw !== undefined && !isNaN(maxCharsRaw) ? maxCharsRaw : undefined;
    const result = await deps.compileSubtree(req.params.nodeId, depth, {
      titlesOnly,
      includeIds,
      maxChars,
      limit: parsedLimit.value,
    });
    return { markdown: result.markdown };
  };
}

export async function cardApiRoutes(app: FastifyInstance): Promise<void> {
  registerServiceErrors(app);

  // POST /api/cards — create a card (agent key auth)
  app.post(
    "/api/cards",
    { preHandler: [agentKeyPreHandler, requireAgentWriteScope] },
    async (req, reply) => {
      const { card, node_id } = await createCard(req.agentId ?? null, parseCreateCardBody(req.body));
      return reply.code(201).send({ ...card, node_id });
    }
  );

  // PATCH /api/cards/:cardId — update a card (agent key auth)
  app.patch<{ Params: { cardId: string } }>(
    "/api/cards/:cardId",
    { preHandler: [agentKeyPreHandler, requireAgentWriteScope] },
    async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      const allowedFields = new Set(["content", "title", "tags", "source_ref", "expected_version"]);
      if (Object.keys(body).some((key) => !allowedFields.has(key))) {
        return reply.code(400).send({ error: "Unknown card update field" });
      }
      const input: UpdateCardInput = {};

      if ("content" in body) input.content = body["content"] as string | null;
      if ("title" in body) input.title = body["title"] as string;
      if ("tags" in body) input.tags = body["tags"] as string[];
      if ("source_ref" in body) input.source_ref = body["source_ref"] as string | null;

      const expectedVersion = body["expected_version"] as number | undefined;
      const result = await updateCard(req.agentId ?? null, req.params.cardId, input, expectedVersion);
      if (!result) throw await cardNotFound(req.params.cardId);
      if ("conflict" in result && result.conflict) {
        return reply.code(409).send({
          error: "VERSION_CONFLICT",
          current_version: result.actualVersion,
          message: versionConflictMessage(req.params.cardId, expectedVersion, result.actualVersion),
        });
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

  // GET /api/tree/outline — body-free structural outline (agent key auth)
  app.get(
    "/api/tree/outline",
    { preHandler: agentKeyPreHandler },
    createTreeOutlineHandler({ getTreeOutline })
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
    createAgentCompileHandler({ compileSubtree })
  );

}
