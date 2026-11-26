import type { FastifyInstance } from "fastify";

import { cardApiRoutes } from "../../src/api/routes/card_api.js";
import { batchRoutes } from "../../src/api/routes/batch.js";
import { cardRoutes } from "../../src/api/routes/cards.js";
import { searchRoutes } from "../../src/api/routes/search.js";
import { treeRoutes } from "../../src/api/routes/tree.js";
import { closeDb } from "../../src/db/client.js";
import type { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import { WRITE_MCP_TOOLS } from "../../src/mcp/tool-scope.js";
import {
  browserApp, makeCard, McpSession, openMcp, openMemoryDb, READ_HEADERS, UNKNOWN_ID, WRITE_HEADERS,
} from "./sqlite-app-harness.js";

// Caller errors carry a machine-readable `code` next to the `error` string, and a read key
// that calls a write tool is told that its scope is the reason.

let db: SqliteAdapter;
let app: FastifyInstance;
let seq = 0;
const unique = (prefix: string) => `${prefix} ${++seq}`;

beforeAll(async () => {
  db = await openMemoryDb();
});
afterAll(async () => {
  await closeDb();
});
beforeEach(async () => {
  app = browserApp();
  await app.register(cardRoutes);
  await app.register(treeRoutes);
  await app.register(batchRoutes);
  await app.register(searchRoutes);
  await app.register(cardApiRoutes);
});
afterEach(async () => {
  await app.close();
});

const shape = (res: { statusCode: number; json(): unknown }) => ({ status: res.statusCode, body: res.json() as Record<string, unknown> });

describe("REST errors carry a code", () => {
  it.each([
    ["an unknown node", "GET", `/tree/${UNKNOWN_ID}`, undefined, 404, "NODE_NOT_FOUND"],
    ["an unknown card", "GET", `/cards/${UNKNOWN_ID}`, undefined, 404, "CARD_NOT_FOUND"],
    ["an unknown parent", "POST", "/cards", { title: "x", parent_node_id: UNKNOWN_ID }, 404, "PARENT_NOT_FOUND"],
    ["a path ID that is not a UUID", "GET", "/tree/not-a-uuid", undefined, 400, "INVALID_ID"],
    ["a body ID that is not a UUID", "POST", "/cards", { title: "x", parent_node_id: "not-a-uuid" }, 400, "INVALID_ID"],
    ["a references entry that is not a UUID", "PUT", `/cards/${UNKNOWN_ID}`, { references: ["nope"] }, 400, "INVALID_ID"],
    ["a blank title", "POST", "/cards", { title: "  " }, 400, "INVALID_INPUT"],
    ["a negative depth", "GET", `/tree/${UNKNOWN_ID}/compile?depth=-1`, undefined, 400, "INVALID_INPUT"],
  ] as const)("%s", async (_label, method, url, payload, status, code) => {
    const res = await app.inject({ method, url, payload });
    const { status: got, body } = shape(res);
    expect([got, body["code"]]).toEqual([status, code]);
    expect(typeof body["error"]).toBe("string");
  });

  it("keeps `error` a string and adds `code` to a version conflict on every route that answers one", async () => {
    const { cardId } = await makeCard(unique("conflict code"));
    await app.inject({ method: "PUT", url: `/cards/${cardId}`, payload: { content: "v2", expected_version: 1 } });
    const stale = { content: "stale", expected_version: 1 };
    const viaPut = shape(await app.inject({ method: "PUT", url: `/cards/${cardId}`, payload: stale }));
    const viaPatch = shape(await app.inject({ method: "PATCH", url: `/api/cards/${cardId}`, headers: WRITE_HEADERS, payload: stale }));
    const viaBatch = shape(await app.inject({ method: "POST", url: "/batch", payload: { updates: [{ card_id: cardId, ...stale }] } }));
    for (const { status, body } of [viaPut, viaPatch, viaBatch]) {
      expect([status, body["code"], typeof body["error"]]).toEqual([409, "VERSION_CONFLICT", "string"]);
    }
  });

  it("leaves responses that already have their own shape alone", async () => {
    const jev = shape(await app.inject({ method: "GET", url: "/search?engine=jev" }));
    expect(jev.status).toBe(400);
    expect(jev.body["error"]).toMatchObject({ code: expect.any(String), message: expect.any(String) });
    expect(jev.body).not.toHaveProperty("code");
  });
});

describe("a read key that calls a write route is told why", () => {
  it.each([
    ["POST", "/api/cards", { title: "x" }],
    ["PATCH", `/api/cards/${UNKNOWN_ID}`, { title: "x" }],
  ] as const)("%s %s answers 403 with INSUFFICIENT_SCOPE", async (method, url, payload) => {
    const res = await app.inject({ method, url, headers: READ_HEADERS, payload });
    const { status, body } = shape(res);
    expect(status).toBe(403);
    expect(body["code"]).toBe("INSUFFICIENT_SCOPE");
    expect(body["error"]).toBe(
      `This API key has read scope, so the write route ${method} ${url.replace(UNKNOWN_ID, ":cardId")} is disabled. Use an API key with write scope.`
    );
  });

  it("does not stop a write key", async () => {
    const res = await app.inject({ method: "POST", url: "/api/cards", headers: WRITE_HEADERS, payload: { title: unique("write ok") } });
    expect(res.statusCode).toBe(201);
  });
});

describe("a read key that calls a write MCP tool", () => {
  let read: McpSession;
  let write: McpSession;
  beforeEach(async () => {
    read = await openMcp("read");
    write = await openMcp("write");
  });
  afterEach(async () => {
    await read.close();
    await write.close();
  });

  it("still does not see the write tools, and write keys see all of them", async () => {
    const readNames = (await read.client.listTools()).tools.map((tool) => tool.name);
    const writeNames = (await write.client.listTools()).tools.map((tool) => tool.name);
    for (const name of WRITE_MCP_TOOLS) {
      expect([name, readNames.includes(name)]).toEqual([name, false]);
      expect([name, writeNames.includes(name)]).toEqual([name, true]);
    }
  });

  it.each(WRITE_MCP_TOOLS)("%s answers that the key has read scope", async (name) => {
    expect(await read.call(name, {})).toEqual({
      isError: true,
      text: `This API key has read scope, so write tools are disabled (${name}). Use an API key with write scope.`,
    });
  });

  it("leaves a tool that does not exist as not found, and read tools working", async () => {
    const missing = await read.call("no_such_tool", {});
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("Tool no_such_tool not found");
    expect(await read.call("get_card", { card_id: UNKNOWN_ID })).toEqual({ isError: true, text: `Card not found: ${UNKNOWN_ID}` });
    const { cardId } = await makeCard(unique("read ok"));
    expect((await read.call("get_card", { card_id: cardId })).isError).toBe(false);
  });

  it("does not run the write tool", async () => {
    const before = Number((await db.query("SELECT COUNT(*) AS n FROM cards")).rows[0]["n"]);
    await read.call("create_card", { card_type: "knowledge", title: "must not exist" });
    expect(Number((await db.query("SELECT COUNT(*) AS n FROM cards")).rows[0]["n"])).toBe(before);
  });
});

describe("MCP and REST read an ID with one rule", () => {
  let mcp: McpSession;
  beforeEach(async () => {
    mcp = await openMcp("write");
  });
  afterEach(async () => {
    await mcp.close();
  });

  const NOT_V4 = "12345678-1234-1234-1234-123456789012";

  it("a UUID-shaped value that is not v4 is looked up, and is not found", async () => {
    expect(await mcp.call("get_card", { card_id: NOT_V4 })).toEqual({ isError: true, text: `Card not found: ${NOT_V4}` });
    expect(await mcp.call("get_node", { node_id: NOT_V4 })).toEqual({ isError: true, text: `Node not found: ${NOT_V4}` });
    const rest = await app.inject({ method: "GET", url: `/cards/${NOT_V4}` });
    expect(rest.statusCode).toBe(404);
  });

  it("a stored card with a non-v4 id is found through MCP", async () => {
    await db.query(
      "INSERT INTO cards (id, card_type, title, content) VALUES ($1, 'knowledge', 'odd id', 'body')",
      [NOT_V4]
    );
    expect((await mcp.call("get_card", { card_id: NOT_V4 })).isError).toBe(false);
  });

  it("a value that is not 8-4-4-4-12 hex names the field and the value", async () => {
    for (const [name, args, field] of [
      ["get_card", { card_id: "not-a-uuid" }, "card_id"],
      ["get_node", { node_id: "not-a-uuid" }, "node_id"],
      ["create_card", { card_type: "knowledge", title: "x", references: ["nope"] }, "references[0]"],
      ["batch_op", { moves: [{ node_id: "nope" }] }, "moves[0].node_id"],
    ] as const) {
      const result = await mcp.call(name, args);
      expect([name, result.isError]).toEqual([name, true]);
      expect(result.text).toContain(`(UUID expected) at ${field}`);
    }
    expect((await mcp.call("get_card", { card_id: "not-a-uuid" })).text).toContain("Invalid UUID: not-a-uuid");
  });
});

describe("PATCH /api/cards/:cardId takes the fields of update_card", () => {
  const patch = (cardId: string, payload: unknown) =>
    app.inject({ method: "PATCH", url: `/api/cards/${cardId}`, headers: WRITE_HEADERS, payload: payload as Record<string, unknown> });

  it("writes every field update_card has, including references", async () => {
    const target = await makeCard(unique("patch target"));
    const other = await makeCard(unique("patch other"));
    const res = await patch(target.cardId, {
      title: "patched title", content: "patched body", tags: ["a", "b"], references: [other.cardId],
      content_timestamp: "2026-01-02T03:04:05.000Z", source_type: "link", source_ref: "https://example.com/x",
      expected_version: 1,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      title: "patched title", content: "patched body", tags: ["a", "b"], references: [other.cardId],
      source_type: "link", source_ref: "https://example.com/x", version: 2,
    });
    const cleared = await patch(target.cardId, { content: null, source_type: null, source_ref: null });
    expect(cleared.json()).toMatchObject({ content: null, source_type: null, source_ref: null });
  });

  it("passes the same checks as update_card", async () => {
    const { cardId } = await makeCard(unique("patch checks"));
    const cases: Array<[string, unknown, number, string]> = [
      ["blank title", { title: " " }, 400, "INVALID_INPUT"],
      ["references entry not a UUID", { references: ["nope"] }, 400, "INVALID_ID"],
      ["references not an array", { references: "nope" }, 400, "INVALID_INPUT"],
      ["references null", { references: null }, 400, "INVALID_INPUT"],
      ["tags not strings", { tags: [1] }, 400, "INVALID_INPUT"],
      ["content a number", { content: 5 }, 400, "INVALID_INPUT"],
      ["expected_version not an integer", { expected_version: "1" }, 400, "INVALID_INPUT"],
      ["unknown field", { notAField: 1 }, 400, "INVALID_INPUT"],
      ["body not an object", [], 400, "INVALID_INPUT"],
      ["stale version", { content: "x", expected_version: 99 }, 409, "VERSION_CONFLICT"],
    ];
    for (const [label, payload, status, code] of cases) {
      const res = await patch(cardId, payload);
      expect([label, res.statusCode, res.json().code]).toEqual([label, status, code]);
    }
    expect((await app.inject({ method: "GET", url: `/cards/${cardId}` })).json()).toMatchObject({ version: 1 });
  });

  it("names the unknown field and the allowed ones", async () => {
    const { cardId } = await makeCard(unique("patch unknown"));
    const res = await patch(cardId, { staleness: "stale", title: "ok" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe(
      "Unknown card update field: staleness (allowed: title, content, tags, references, content_timestamp, source_type, source_ref, expected_version)"
    );
  });
});

describe("batch_op tells what moves and child_orders do, and does so", () => {
  let mcp: McpSession;
  beforeEach(async () => {
    mcp = await openMcp("write");
  });
  afterEach(async () => {
    await mcp.close();
  });

  const parentOf = async (nodeId: string) =>
    (await db.query("SELECT parent_node_id FROM tree_nodes WHERE id = $1", [nodeId])).rows[0]["parent_node_id"];

  it("moves without new_parent_node_id keep the parent, and child_orders pull in a node from another parent", async () => {
    const parentA = await makeCard(unique("batch parent A"));
    const parentB = await makeCard(unique("batch parent B"));
    const first = await makeCard(unique("child 1"), parentA.nodeId);
    const second = await makeCard(unique("child 2"), parentA.nodeId);
    const foreign = await makeCard(unique("child foreign"), parentB.nodeId);

    expect((await mcp.call("batch_op", { moves: [{ node_id: first.nodeId, to: "end" }] })).isError).toBe(false);
    expect(await parentOf(first.nodeId)).toBe(parentA.nodeId);

    const ordered = await mcp.call("batch_op", {
      child_orders: [{ parent_node_id: parentA.nodeId, order: [second.nodeId, foreign.nodeId, first.nodeId] }],
    });
    expect(ordered.isError).toBe(false);
    expect(await parentOf(foreign.nodeId)).toBe(parentA.nodeId);
  });

  it("rejects more than one position field, as the description says", async () => {
    const parent = await makeCard(unique("batch pos parent"));
    const sibling = await makeCard(unique("batch pos sibling"), parent.nodeId);
    const moving = await makeCard(unique("batch pos moving"), parent.nodeId);
    const result = await mcp.call("batch_op", { moves: [{ node_id: moving.nodeId, before: sibling.nodeId, to: "start" }] });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("only one of before, after, to, or position may be specified");
  });

  it("states those rules in the tool description", async () => {
    const batch = (await mcp.client.listTools()).tools.find((tool) => tool.name === "batch_op");
    const description = batch?.description ?? "";
    expect(description).toContain("omit it = the node stays under its current parent");
    expect(description).toContain("choose at most one of before, after, to");
    expect(description).toContain("including a node that currently sits under another parent: it is moved there, silently");
  });
});
