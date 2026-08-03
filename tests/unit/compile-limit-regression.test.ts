import Fastify from "fastify";
import pg from "pg";
import { jest } from "@jest/globals";

import { createAgentCompileHandler } from "../../src/api/routes/card_api.js";
import { parseCompileLimit } from "../../src/api/routes/compile-limit.js";
import { compileNode } from "../../src/shared/bfs.js";
import type { Card, TreeNode } from "../../src/shared/types.js";
import { makeCard, makeNode } from "./bfs-fixtures.js";

describe("compile limit regressions", () => {
  it("confirms pg parses TIMESTAMPTZ as a Date at runtime", () => {
    const parseTimestamp = pg.types.getTypeParser(1184);

    const parsed = parseTimestamp("2026-08-03 09:00:00+09");

    expect(parsed).toBeInstanceOf(Date);
    expect((parsed as Date).toISOString()).toBe("2026-08-03T00:00:00.000Z");
  });

  it("sorts Date, string, null, and invalid timestamps without throwing", () => {
    const cards = new Map<string, Card>([
      ["card-root", makeCard({ id: "card-root", title: "Root" })],
      ["card-null", { ...makeCard({ id: "card-null", title: "Null" }), card_timestamp: null }],
      ["card-recent", makeCard({
        id: "card-recent",
        title: "Recent Date",
        card_timestamp: new Date("2026-01-04T00:00:00Z"),
      })],
      ["card-invalid", makeCard({
        id: "card-invalid",
        title: "Invalid Date",
        card_timestamp: new Date("invalid"),
      })],
      ["card-middle", makeCard({
        id: "card-middle",
        title: "Middle String",
        card_timestamp: "2026-01-03T00:00:00Z",
      })],
      ["card-old", makeCard({
        id: "card-old",
        title: "Old Date",
        card_timestamp: new Date("2026-01-01T00:00:00Z"),
      })],
    ]);
    const nodes = new Map<string, TreeNode>([
      ["node-root", makeNode({ id: "node-root", card_id: "card-root" })],
      ["node-null", makeNode({ id: "node-null", card_id: "card-null", parent_node_id: "node-root", position: 100 })],
      ["node-recent", makeNode({ id: "node-recent", card_id: "card-recent", parent_node_id: "node-root", position: 200 })],
      ["node-invalid", makeNode({ id: "node-invalid", card_id: "card-invalid", parent_node_id: "node-root", position: 300 })],
      ["node-middle", makeNode({ id: "node-middle", card_id: "card-middle", parent_node_id: "node-root", position: 400 })],
      ["node-old", makeNode({ id: "node-old", card_id: "card-old", parent_node_id: "node-root", position: 500 })],
    ]);
    const getChildren = (nodeId: string): TreeNode[] =>
      Array.from(nodes.values())
        .filter((node) => node.parent_node_id === nodeId)
        .sort((a, b) => a.position - b.position);

    const markdown = compileNode(
      "node-root",
      (nodeId) => ({
        card_id: nodes.get(nodeId)!.card_id,
        is_symlink: nodes.get(nodeId)!.is_symlink,
      }),
      getChildren,
      (cardId) => cards.get(cardId)!,
      1,
      new Set(),
      1,
      { limit: 5 }
    );

    expect(markdown.indexOf("Recent Date")).toBeLessThan(markdown.indexOf("Middle String"));
    expect(markdown.indexOf("Middle String")).toBeLessThan(markdown.indexOf("Old Date"));
    expect(markdown.indexOf("Old Date")).toBeLessThan(markdown.indexOf("Null"));
    expect(markdown.indexOf("Old Date")).toBeLessThan(markdown.indexOf("Invalid Date"));
  });

  it.each(["0", "-1", "1.5", "1oops", "", "9007199254740992"])(
    "rejects an invalid REST limit value: %s",
    (raw) => {
      expect(parseCompileLimit(raw)).toEqual({
        ok: false,
        error: "limit must be a positive safe integer",
      });
    }
  );

  it("accepts an absent or positive REST limit value", () => {
    expect(parseCompileLimit(undefined)).toEqual({ ok: true, value: undefined });
    expect(parseCompileLimit("3")).toEqual({ ok: true, value: 3 });
    expect(parseCompileLimit(["3"])).toEqual({
      ok: false,
      error: "limit must be a positive safe integer",
    });
  });

  it("forwards limit through the agent REST compile route", async () => {
    const compileSubtree = jest.fn(async () => ({ markdown: "limited" }));
    const app = Fastify({ logger: false });
    app.get("/api/tree/:nodeId/compile", createAgentCompileHandler({ compileSubtree }));

    const response = await app.inject({
      method: "GET",
      url: "/api/tree/node-1/compile?depth=1&titles_only=true&include_ids=true&limit=1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ markdown: "limited" });
    expect(compileSubtree).toHaveBeenCalledWith("node-1", 1, {
      titlesOnly: true,
      includeIds: true,
      maxChars: undefined,
      limit: 1,
    });
    await app.close();
  });

  it("returns 400 instead of silently ignoring an invalid REST limit", async () => {
    const compileSubtree = jest.fn(async () => ({ markdown: "unbounded" }));
    const app = Fastify({ logger: false });
    app.get("/api/tree/:nodeId/compile", createAgentCompileHandler({ compileSubtree }));

    const response = await app.inject({
      method: "GET",
      url: "/api/tree/node-1/compile?limit=oops",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "limit must be a positive safe integer" });
    expect(compileSubtree).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 500 instead of an unbounded result when limited compilation fails", async () => {
    const compileSubtree = jest.fn(async () => {
      throw new TypeError("timestamp comparison failed");
    });
    const app = Fastify({ logger: false });
    app.get("/api/tree/:nodeId/compile", createAgentCompileHandler({ compileSubtree }));

    const response = await app.inject({
      method: "GET",
      url: "/api/tree/node-1/compile?limit=1",
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).not.toHaveProperty("markdown");
    expect(compileSubtree).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
