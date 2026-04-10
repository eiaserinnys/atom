import type { FastifyInstance } from "fastify";
import {
  getNode,
  listChildren,
  compileSubtree,
  createSymlink,
  deleteNode,
  moveNode,
} from "../../services/tree.service.js";

export async function treeRoutes(app: FastifyInstance): Promise<void> {
  // GET /tree  — root nodes (parent_node_id = null)
  // depth query param is accepted for forward compatibility but currently returns
  // the flat root list (not a compiled tree). Depth-based tree compilation is
  // performed per-node via GET /tree/:nodeId/compile.
  app.get("/tree", async (req, reply) => {
    return listChildren(null);
  });

  // GET /tree/:nodeId
  app.get<{ Params: { nodeId: string } }>(
    "/tree/:nodeId",
    async (req, reply) => {
      const node = await getNode(req.params.nodeId);
      if (!node) return reply.code(404).send({ error: "Node not found" });
      return node;
    }
  );

  // GET /tree/:nodeId/children
  app.get<{ Params: { nodeId: string } }>(
    "/tree/:nodeId/children",
    async (req, reply) => {
      const children = await listChildren(req.params.nodeId);
      return children;
    }
  );

  // GET /tree/:nodeId/compile
  app.get<{ Params: { nodeId: string } }>(
    "/tree/:nodeId/compile",
    async (req, reply) => {
      const qs = req.query as Record<string, string>;
      const depthStr = qs["depth"];
      const depth = depthStr === "Infinity"
        ? Infinity
        : depthStr !== undefined && !isNaN(parseInt(depthStr, 10))
          ? parseInt(depthStr, 10)
          : 3;
      const includeIds = qs["include_ids"] === "true";
      const titlesOnly = qs["titles_only"] === "true";
      const numbering = qs["numbering"] === "true";
      const maxCharsRaw = qs["max_chars"] !== undefined ? parseInt(qs["max_chars"]) : undefined;
      const maxChars = maxCharsRaw !== undefined && !isNaN(maxCharsRaw) ? maxCharsRaw : undefined;
      const excludeNodesRaw = qs["exclude_nodes"];
      const excludeNodes = excludeNodesRaw
        ? new Set(excludeNodesRaw.split(",").map((s) => s.trim()))
        : undefined;
      const limit = qs["limit"] !== undefined ? parseInt(qs["limit"]) : undefined;
      const result = await compileSubtree(req.params.nodeId, depth, {
        includeIds: includeIds || undefined,
        titlesOnly: titlesOnly || undefined,
        numbering: numbering || undefined,
        maxChars: maxChars,
        excludeNodes: excludeNodes,
        limit,
      });
      return { markdown: result.markdown };
    }
  );

  // POST /tree/:nodeId/compile — compile with credentials (for unfurl)
  app.post<{ Params: { nodeId: string } }>(
    "/tree/:nodeId/compile",
    async (req, reply) => {
      const body = req.body as Record<string, unknown> | null ?? {};
      const depth = body["depth"] === null
        ? Infinity
        : typeof body["depth"] === "number" ? body["depth"] : 3;
      const resolveRefs = (body["resolveRefs"] as "cached" | "fresh" | undefined) ?? undefined;
      const credentials = (body["credentials"] as Record<string, Record<string, string>> | undefined) ?? undefined;
      const result = await compileSubtree(
        req.params.nodeId,
        depth,
        {},
        resolveRefs,
        credentials
      );
      return result;
    }
  );

  // POST /tree/symlink
  app.post("/tree/symlink", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const node = await createSymlink(
      body["card_id"] as string,
      (body["parent_node_id"] as string | null) ?? null,
      body["position"] as number | undefined
    );
    return reply.code(201).send(node);
  });

  // PUT /tree/:nodeId/move
  app.put<{ Params: { nodeId: string } }>(
    "/tree/:nodeId/move",
    async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      const moved = await moveNode(
        req.params.nodeId,
        (body["parent_node_id"] as string | null) ?? null,
        body["position"] as number | undefined
      );
      if (!moved) return reply.code(404).send({ error: "Node not found" });
      return moved;
    }
  );

  // DELETE /tree/:nodeId
  app.delete<{ Params: { nodeId: string } }>(
    "/tree/:nodeId",
    async (req, reply) => {
      const deleted = await deleteNode(req.params.nodeId);
      if (!deleted) return reply.code(404).send({ error: "Node not found" });
      return reply.code(204).send();
    }
  );
}
