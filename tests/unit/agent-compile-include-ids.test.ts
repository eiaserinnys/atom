import Fastify from "fastify";

import { createAgentCompileHandler } from "../../src/api/routes/card_api.js";
import { compileNode, type CompileOptions } from "../../src/shared/bfs.js";
import type { Card, TreeNode } from "../../src/shared/types.js";
import { makeCard, makeNode } from "./bfs-fixtures.js";

describe("agent REST compile include_ids contract", () => {
  const cards = new Map<string, Card>([
    ["card-root", makeCard({ id: "card-root", title: "Root" })],
    ["card-child", makeCard({ id: "card-child", title: "Child" })],
  ]);
  const nodes = new Map<string, TreeNode>([
    ["node-root", makeNode({ id: "node-root", card_id: "card-root" })],
    [
      "node-child",
      makeNode({
        id: "node-child",
        card_id: "card-child",
        parent_node_id: "node-root",
      }),
    ],
  ]);
  const getNodeCard = (nodeId: string) => ({
    card_id: nodes.get(nodeId)!.card_id,
    is_symlink: nodes.get(nodeId)!.is_symlink,
  });
  const getChildren = (nodeId: string): TreeNode[] =>
    Array.from(nodes.values()).filter((node) => node.parent_node_id === nodeId);
  const getCard = (cardId: string): Card => cards.get(cardId)!;

  const compileSubtree = async (
    nodeId: string,
    depth = 3,
    options: CompileOptions = {}
  ) => ({
    markdown: compileNode(
      nodeId,
      getNodeCard,
      getChildren,
      getCard,
      depth,
      new Set(),
      1,
      options
    ),
  });

  it.each([
    { mode: "titles_only", query: "&titles_only=true" },
    { mode: "heading", query: "" },
  ])("preserves omitted, true, and false in $mode mode", async ({ mode, query }) => {
    const app = Fastify({ logger: false });
    app.get("/api/tree/:nodeId/compile", createAgentCompileHandler({ compileSubtree }));

    const request = async (includeIds?: boolean) => {
      const includeIdsQuery = includeIds === undefined
        ? ""
        : `&include_ids=${String(includeIds)}`;
      const response = await app.inject({
        method: "GET",
        url: `/api/tree/node-root/compile?depth=1${query}${includeIdsQuery}`,
      });
      expect(response.statusCode).toBe(200);
      return response.json<{ markdown: string }>().markdown;
    };

    const omitted = await request();
    const explicitTrue = await request(true);
    const explicitFalse = await request(false);

    if (mode === "titles_only") {
      expect(new Set([omitted, explicitTrue, explicitFalse]).size).toBe(3);
      expect(omitted).toContain("[node:node-root card:card-root]");
      expect(explicitTrue).toContain("<!-- node:node-root card:card-root");
    } else {
      expect(omitted).toBe(explicitTrue);
      expect(omitted).toContain("<!-- node:node-root card:card-root");
      expect(explicitFalse).not.toBe(omitted);
    }
    expect(explicitFalse.match(/node:/g) ?? []).toHaveLength(0);
    expect(explicitFalse.match(/card:/g) ?? []).toHaveLength(0);

    await app.close();
  });
});
