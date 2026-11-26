import path from "path";
import { fileURLToPath } from "url";

import bcrypt from "bcryptjs";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { agentKeyVerifier } from "../../src/api/agent-key-auth.js";
import { authMiddleware } from "../../src/api/middleware/auth.js";
import { batchRoutes } from "../../src/api/routes/batch.js";
import { cardApiRoutes } from "../../src/api/routes/card_api.js";
import { cardRoutes } from "../../src/api/routes/cards.js";
import { configRoutes } from "../../src/api/routes/config.js";
import { searchRoutes } from "../../src/api/routes/search.js";
import { treeRoutes } from "../../src/api/routes/tree.js";
import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import { closeDb, setDb } from "../../src/db/client.js";
import { insertAgent } from "../../src/db/queries/agents.js";
import { registerBatchTools } from "../../src/mcp/tools/batch_tools.js";
import { registerCardTools } from "../../src/mcp/tools/card_tools.js";
import { registerSearchTools } from "../../src/mcp/tools/search_tools.js";
import { registerTreeTools } from "../../src/mcp/tools/tree_tools.js";
import { createCard, getCard } from "../../src/services/card.service.js";
import { createSymlink } from "../../src/services/tree.service.js";

// Wrong or missing IDs and bad input must say what is wrong, the same way on MCP and REST.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations-sqlite");
const KEY = "errors-and-ids-key";
const KEY_HEADERS = { "x-api-key": KEY };
const UNKNOWN = "00000000-0000-4000-8000-000000000123";
const UNKNOWN_2 = "00000000-0000-4000-8000-000000000456";
const AGENT = "errors-agent";
const originalEnv = { ...process.env };

const CONFLICT_HINT = "Re-read the card with get_card, merge your change into the latest content, and retry with its version as expected_version.";
const cardHint = (nodeId: string) => `This ID is a card_id (card content), but this tool takes a node_id (tree position). The card's node: ${nodeId}`;
const nodeHint = (cardId: string) => `This ID is a node_id (tree position), but this tool takes a card_id (card content). Its card_id: ${cardId}`;

let db: SqliteAdapter;
let app: FastifyInstance;
let configApp: FastifyInstance;
let mcp: Client;
let mcpServer: McpServer;
let seq = 0;

async function make(title: string, parent: string | null = null) {
  const created = await createCard({ card_type: "knowledge", title, content: `body ${title}`, parent_node_id: parent });
  return { cardId: created.card.id, nodeId: created.node_id };
}

async function tool(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  try {
    const result = await mcp.callTool({ name, arguments: args });
    const content = result.content as Array<{ text: string }>;
    return { isError: result.isError === true, text: content[0]?.text ?? "" };
  } catch (error) {
    return { isError: true, text: (error as Error).message };
  }
}

const unique = (prefix: string) => `${prefix} ${++seq}`;

beforeAll(async () => {
  process.env["JWT_SECRET"] = "errors-and-ids-secret";
  delete process.env["GOOGLE_CLIENT_ID"];
  delete process.env["SLACK_CLIENT_ID"];
  delete process.env["DASHBOARD_ADMIN_PASSWORD"];
  process.env["AUTH_BYPASS"] = "1";
  db = new SqliteAdapter(":memory:");
  setDb(db);
  await db.runMigrations(MIGRATIONS_DIR);
  await insertAgent(db, { agent_id: AGENT, secret_hash: await bcrypt.hash(KEY, 4), scope: "write" });
});

afterAll(async () => {
  await closeDb();
  process.env = { ...originalEnv };
});

beforeEach(async () => {
  agentKeyVerifier.clear();
  app = Fastify({ logger: false });
  await app.register(cookie);
  app.addHook("preHandler", authMiddleware);
  await app.register(cardRoutes);
  await app.register(treeRoutes);
  await app.register(searchRoutes);
  await app.register(batchRoutes);
  await app.register(cardApiRoutes);

  configApp = Fastify({ logger: false });
  configApp.addHook("preHandler", async (request) => {
    request.jwtUser = { id: "bypass", email: "bypass@local", name: "Bypass Admin", role: "admin" };
  });
  await configApp.register(configRoutes);

  mcpServer = new McpServer({ name: "errors-and-ids", version: "1" });
  registerCardTools(mcpServer, AGENT);
  registerTreeTools(mcpServer);
  registerSearchTools(mcpServer);
  registerBatchTools(mcpServer, AGENT);
  mcp = new Client({ name: "errors-and-ids-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  await mcp.connect(clientTransport);
});

afterEach(async () => {
  await mcp.close();
  await mcpServer.close();
  await app.close();
  await configApp.close();
});

const get = (url: string) => app.inject({ method: "GET", url });
const agentGet = (url: string) => app.inject({ method: "GET", url, headers: KEY_HEADERS });
const body = (res: { json(): unknown }) => res.json() as { error: string };

describe("a missing target is an error, not an empty result", () => {
  it("list_children and GET children say Node not found; root listing still works", async () => {
    const result = await tool("list_children", { parent_node_id: UNKNOWN });
    expect(result).toEqual({ isError: true, text: `Node not found: ${UNKNOWN}` });
    const browser = await get(`/tree/${UNKNOWN}/children`);
    const agent = await agentGet(`/api/tree/${UNKNOWN}/children`);
    expect([browser.statusCode, agent.statusCode]).toEqual([404, 404]);
    expect(body(browser)).toEqual({ error: `Node not found: ${UNKNOWN}` });
    expect(body(agent)).toEqual(body(browser));

    expect((await tool("list_children", {})).isError).toBe(false);
    expect((await tool("list_children", { parent_node_id: null })).isError).toBe(false);
    expect((await get("/tree")).statusCode).toBe(200);
  });

  it("search_cards with an unknown root_node_id says Node not found", async () => {
    expect(await tool("search_cards", { query: "anything", root_node_id: UNKNOWN }))
      .toEqual({ isError: true, text: `Node not found: ${UNKNOWN}` });
    const rest = await get(`/search?q=anything&root_node_id=${UNKNOWN}`);
    expect(rest.statusCode).toBe(404);
    expect(body(rest)).toEqual({ error: `Node not found: ${UNKNOWN}` });
    const camel = await get(`/search?q=anything&rootNodeId=${UNKNOWN}`);
    expect(camel.statusCode).toBe(404);
  });

  it("get_backlinks of an unknown card says Card not found", async () => {
    expect(await tool("get_backlinks", { card_id: UNKNOWN }))
      .toEqual({ isError: true, text: `Card not found: ${UNKNOWN}` });
    const rest = await get(`/backlinks/${UNKNOWN}`);
    expect(rest.statusCode).toBe(404);
    expect(body(rest)).toEqual({ error: `Card not found: ${UNKNOWN}` });
  });
});

describe("a node_id and a card_id that were swapped are named", () => {
  it.each([
    ["get_node", {}],
    ["list_children", {}],
    ["compile_subtree", {}],
    ["update_node", { journal_limit: 3 }],
    ["delete_node", {}],
    ["move_node", { to: "end" }],
  ] as const)("%s given a card_id", async (name, extra) => {
    const { cardId, nodeId } = await make(unique("swap node tool"));
    const arg = name === "list_children" ? "parent_node_id" : "node_id";
    const result = await tool(name, { [arg]: cardId, ...extra });
    expect(result).toEqual({ isError: true, text: `Node not found: ${cardId}. ${cardHint(nodeId)}` });
  });

  it.each([
    ["get_card", {}],
    ["get_backlinks", {}],
    ["update_card", { title: "renamed" }],
    ["delete_card", {}],
  ] as const)("%s given a node_id", async (name, extra) => {
    const { cardId, nodeId } = await make(unique("swap card tool"));
    const result = await tool(name, { card_id: nodeId, ...extra });
    expect(result).toEqual({ isError: true, text: `Card not found: ${nodeId}. ${nodeHint(cardId)}` });
  });

  it("names the canonical node, not a symlink, and the same text comes from REST", async () => {
    const { cardId, nodeId } = await make(unique("swap canonical"));
    const other = await make(unique("swap other root"));
    await createSymlink(cardId, other.nodeId);
    const expectedNode = `Node not found: ${cardId}. ${cardHint(nodeId)}`;
    expect((await tool("get_node", { node_id: cardId })).text).toBe(expectedNode);
    expect(body(await get(`/tree/${cardId}`))).toEqual({ error: expectedNode });
    expect(body(await agentGet(`/api/tree/${cardId}/children`))).toEqual({ error: expectedNode });
    expect(body(await get(`/tree/${cardId}/compile`))).toEqual({ error: expectedNode });
    expect((await app.inject({ method: "DELETE", url: `/tree/${cardId}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "PATCH", url: `/tree/${cardId}`, payload: { journal_limit: 1 } })).statusCode).toBe(404);
    expect((await app.inject({ method: "PUT", url: `/tree/${cardId}/move`, payload: {} })).statusCode).toBe(404);

    const expectedCard = `Card not found: ${nodeId}. ${nodeHint(cardId)}`;
    expect(body(await get(`/cards/${nodeId}`))).toEqual({ error: expectedCard });
    expect(body(await get(`/backlinks/${nodeId}`))).toEqual({ error: expectedCard });
    expect(body(await app.inject({ method: "PUT", url: `/cards/${nodeId}`, payload: { content: "x" } }))).toEqual({ error: expectedCard });
    expect(body(await app.inject({ method: "DELETE", url: `/cards/${nodeId}` }))).toEqual({ error: expectedCard });
    expect(body(await app.inject({ method: "PATCH", url: `/api/cards/${nodeId}`, headers: KEY_HEADERS, payload: { content: "x" } }))).toEqual({ error: expectedCard });
  });

  it("search_cards root_node_id given a card_id names the node", async () => {
    const { cardId, nodeId } = await make(unique("swap search root"));
    expect(await tool("search_cards", { query: "anything", root_node_id: cardId }))
      .toEqual({ isError: true, text: `Node not found: ${cardId}. ${cardHint(nodeId)}` });
  });
});

describe("writes check that the parent node and card exist", () => {
  const rowCount = async (table: string) =>
    Number((await db.query(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0]["n"]);

  it("create_card and POST /cards: unknown parent, card_id as parent", async () => {
    const before = await rowCount("cards");
    const { cardId, nodeId } = await make(unique("parent probe"));
    const inserted = before + 1;
    expect(await tool("create_card", { card_type: "knowledge", title: "x", parent_node_id: UNKNOWN }))
      .toEqual({ isError: true, text: `Parent node not found: ${UNKNOWN}` });
    expect(await tool("create_card", { card_type: "knowledge", title: "x", parent_node_id: cardId }))
      .toEqual({ isError: true, text: `Parent node not found: ${cardId}. ${cardHint(nodeId)}` });
    for (const [url, headers] of [["/cards", {}], ["/api/cards", KEY_HEADERS]] as const) {
      const res = await app.inject({ method: "POST", url, headers, payload: { card_type: "knowledge", title: "x", parent_node_id: UNKNOWN } });
      expect([url, res.statusCode, body(res)]).toEqual([url, 404, { error: `Parent node not found: ${UNKNOWN}` }]);
    }
    expect(await rowCount("cards")).toBe(inserted);
  });

  it("create_symlink and POST /tree/symlink: unknown card, unknown parent", async () => {
    const { cardId, nodeId } = await make(unique("symlink probe"));
    const before = await rowCount("tree_nodes");
    expect(await tool("create_symlink", { card_id: UNKNOWN, parent_node_id: null }))
      .toEqual({ isError: true, text: `Card not found: ${UNKNOWN}` });
    expect(await tool("create_symlink", { card_id: nodeId, parent_node_id: null }))
      .toEqual({ isError: true, text: `Card not found: ${nodeId}. ${nodeHint(cardId)}` });
    expect(await tool("create_symlink", { card_id: cardId, parent_node_id: UNKNOWN }))
      .toEqual({ isError: true, text: `Parent node not found: ${UNKNOWN}` });
    const missingCard = await app.inject({ method: "POST", url: "/tree/symlink", payload: { card_id: UNKNOWN } });
    expect([missingCard.statusCode, body(missingCard)]).toEqual([404, { error: `Card not found: ${UNKNOWN}` }]);
    const missingParent = await app.inject({ method: "POST", url: "/tree/symlink", payload: { card_id: cardId, parent_node_id: UNKNOWN } });
    expect([missingParent.statusCode, body(missingParent)]).toEqual([404, { error: `Parent node not found: ${UNKNOWN}` }]);
    expect(await rowCount("tree_nodes")).toBe(before);
  });

  it("move_node and PUT move: unknown new parent", async () => {
    const { nodeId } = await make(unique("move probe"));
    expect(await tool("move_node", { node_id: nodeId, parent_node_id: UNKNOWN }))
      .toEqual({ isError: true, text: `Parent node not found: ${UNKNOWN}` });
    const res = await app.inject({ method: "PUT", url: `/tree/${nodeId}/move`, payload: { parent_node_id: UNKNOWN } });
    expect([res.statusCode, body(res)]).toEqual([404, { error: `Parent node not found: ${UNKNOWN}` }]);
  });

  it("batch_op rolls everything back on an unknown parent or card, in every operation", async () => {
    const { cardId, nodeId } = await make(unique("batch probe"));
    const createdTitle = unique("batch rolled back");
    const scenarios: Array<[string, Record<string, unknown>, string]> = [
      ["creates parent", { creates: [{ temp_id: "t", card_type: "knowledge", title: "x", parent_node_id: UNKNOWN }] }, `Parent node not found: ${UNKNOWN}`],
      ["symlinks card", { symlinks: [{ card_id: UNKNOWN, parent_node_id: null }] }, `Card not found: ${UNKNOWN}`],
      ["symlinks card given a node_id", { symlinks: [{ card_id: nodeId, parent_node_id: null }] }, `Card not found: ${nodeId}. ${nodeHint(cardId)}`],
      ["symlinks parent", { symlinks: [{ card_id: cardId, parent_node_id: UNKNOWN }] }, `Parent node not found: ${UNKNOWN}`],
      ["moves parent", { moves: [{ node_id: nodeId, new_parent_node_id: UNKNOWN }] }, `Parent node not found: ${UNKNOWN}`],
      ["moves node", { moves: [{ node_id: UNKNOWN, new_parent_node_id: null }] }, `Node not found: ${UNKNOWN}`],
      ["child_orders parent", { child_orders: [{ parent_node_id: UNKNOWN, order: [nodeId] }] }, `Parent node not found: ${UNKNOWN}`],
    ];
    for (const [label, ops, message] of scenarios) {
      const okItem = { temp_id: "ok", card_type: "knowledge", title: createdTitle };
      const batch = { ...ops, creates: [okItem, ...((ops["creates"] as unknown[] | undefined) ?? [])] };
      const viaMcp = await tool("batch_op", batch);
      expect([label, viaMcp.isError, viaMcp.text]).toEqual([label, true, message]);
      const viaRest = await app.inject({ method: "POST", url: "/batch", payload: batch });
      expect([label, viaRest.statusCode, body(viaRest)]).toEqual([label, 404, { error: message }]);
    }
    const leftovers = await db.query("SELECT COUNT(*) AS n FROM cards WHERE title = $1", [createdTitle]);
    expect(Number(leftovers.rows[0]["n"])).toBe(0);
  });

  it("POST /api/config/agents answers a repeated agent_id with 409", async () => {
    const first = await configApp.inject({ method: "POST", url: "/api/config/agents", payload: { agent_id: "dup-agent" } });
    expect(first.statusCode).toBe(201);
    const second = await configApp.inject({ method: "POST", url: "/api/config/agents", payload: { agent_id: "dup-agent" } });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: "agent_id already exists: dup-agent" });
  });
});

describe("card titles follow one rule everywhere", () => {
  const blank = "title must not be empty or whitespace only";
  const tooLong = `title must be at most 50 characters (got 51)`;
  const long = "x".repeat(51);

  it.each([
    ["create_card", (title: string, _id: string) => ({ card_type: "knowledge", title })],
    ["update_card", (title: string, id: string) => ({ card_id: id, title })],
  ] as const)("%s rejects empty, blank and long titles", async (name, args) => {
    const { cardId } = await make(unique("title mcp"));
    for (const title of ["", "   ", long]) {
      const result = await tool(name, args(title, cardId));
      expect([JSON.stringify(title), result.isError]).toEqual([JSON.stringify(title), true]);
    }
    expect((await tool(name, args(" ", cardId))).text).toContain(blank);
    expect((await tool(name, args(long, cardId))).text).toMatch(/50/);
    expect(await getCard(cardId)).toMatchObject({ version: 1 });
  });

  it("batch_op creates and updates reject them on MCP and REST", async () => {
    const { cardId } = await make(unique("title batch"));
    for (const title of ["", "   ", long]) {
      const problem = title === long ? tooLong : blank;
      const bad = [
        { creates: [{ temp_id: "a", card_type: "knowledge", title }] },
        { updates: [{ card_id: cardId, title }] },
      ];
      for (const batch of bad) {
        const viaRest = await app.inject({ method: "POST", url: "/batch", payload: batch });
        expect([JSON.stringify(title), viaRest.statusCode, body(viaRest).error]).toEqual([JSON.stringify(title), 400, problem]);
        expect((await tool("batch_op", batch)).isError).toBe(true);
      }
    }
    expect(await getCard(cardId)).toMatchObject({ version: 1 });
  });

  it("REST create and update answer 400 with the reason; a valid title is kept as is", async () => {
    const { cardId } = await make(unique("title rest"));
    const cases: Array<[string, string, string, Record<string, unknown>, Record<string, string>]> = [
      ["POST", "/cards", "", { title: "  " }, {}],
      ["POST", "/api/cards", "", { title: "  " }, KEY_HEADERS],
      ["PUT", `/cards/${cardId}`, "", { title: "" }, {}],
      ["PATCH", `/api/cards/${cardId}`, "", { title: "  " }, KEY_HEADERS],
    ];
    for (const [method, url, , payload, headers] of cases) {
      const res = await app.inject({ method: method as "POST", url, payload, headers });
      expect([method, url, res.statusCode, body(res).error]).toEqual([method, url, 400, blank]);
    }
    for (const [method, url, payload, headers] of [
      ["POST", "/cards", { title: long }, {}],
      ["PUT", `/cards/${cardId}`, { title: long }, {}],
      ["PATCH", `/api/cards/${cardId}`, { title: long }, KEY_HEADERS],
    ] as const) {
      const res = await app.inject({ method, url, payload, headers });
      expect([method, url, res.statusCode, body(res).error]).toEqual([method, url, 400, tooLong]);
    }
    const nullTitle = await app.inject({ method: "PUT", url: `/cards/${cardId}`, payload: { title: null } });
    expect(nullTitle.statusCode).toBe(400);
    const ok = await app.inject({ method: "PUT", url: `/cards/${cardId}`, payload: { title: "x".repeat(50) } });
    expect(ok.statusCode).toBe(200);
    expect(await getCard(cardId)).toMatchObject({ title: "x".repeat(50) });
  });

  it("does not touch an existing card whose title is already blank", async () => {
    const { cardId } = await make(unique("title legacy"));
    await db.query("UPDATE cards SET title = '' WHERE id = $1", [cardId]);
    const res = await app.inject({ method: "PUT", url: `/cards/${cardId}`, payload: { content: "edited" } });
    expect(res.statusCode).toBe(200);
    expect(await getCard(cardId)).toMatchObject({ title: "", content: "edited" });
    expect((await tool("update_card", { card_id: cardId, content: "again" })).isError).toBe(false);
  });

  it("POST /cards validates card_type and defaults it like POST /api/cards", async () => {
    for (const [url, headers] of [["/cards", {}], ["/api/cards", KEY_HEADERS]] as const) {
      const bad = await app.inject({ method: "POST", url, headers, payload: { title: unique("type"), card_type: "folder" } });
      expect([url, bad.statusCode, body(bad).error]).toEqual([url, 400, "card_type must be one of: structure, knowledge"]);
      const defaulted = await app.inject({ method: "POST", url, headers, payload: { title: unique("type default") } });
      expect([url, defaulted.statusCode, defaulted.json().card_type]).toEqual([url, 201, "knowledge"]);
      const noBody = await app.inject({ method: "POST", url, headers });
      expect([url, noBody.statusCode]).toEqual([url, 400]);
    }
  });
});

describe("a version conflict says what to do next", () => {
  it("MCP update_card, batch_op updates and both REST routes carry the same hint", async () => {
    const { cardId } = await make(unique("conflict"));
    await tool("update_card", { card_id: cardId, content: "v2", expected_version: 1 });
    const message = `VersionConflict: card ${cardId} expected version 1, actual 2. ${CONFLICT_HINT}`;

    expect(await tool("update_card", { card_id: cardId, content: "stale", expected_version: 1 })).toEqual({ isError: true, text: message });
    const batch = { updates: [{ card_id: cardId, content: "stale", expected_version: 1 }] };
    expect(await tool("batch_op", batch)).toEqual({ isError: true, text: message });
    const viaBatch = await app.inject({ method: "POST", url: "/batch", payload: batch });
    expect([viaBatch.statusCode, body(viaBatch)]).toEqual([409, { error: message }]);

    const put = await app.inject({ method: "PUT", url: `/cards/${cardId}`, payload: { content: "stale", expected_version: 1 } });
    const patch = await app.inject({ method: "PATCH", url: `/api/cards/${cardId}`, headers: KEY_HEADERS, payload: { content: "stale", expected_version: 1 } });
    for (const res of [put, patch]) {
      expect([res.statusCode, res.json()]).toEqual([409, { error: "VERSION_CONFLICT", current_version: 2, message }]);
    }
  });
});

describe("created_by and updated_by come from the x-api-key's agent", () => {
  it("records the agent on REST create and update, like MCP does", async () => {
    const viaRest = await app.inject({ method: "POST", url: "/api/cards", headers: KEY_HEADERS, payload: { title: unique("authored rest") } });
    expect(viaRest.statusCode).toBe(201);
    expect(viaRest.json()).toMatchObject({ created_by: AGENT, updated_by: AGENT });

    const viaMcp = JSON.parse((await tool("create_card", { card_type: "knowledge", title: unique("authored mcp") })).text);
    expect(viaMcp).toMatchObject({ created_by: AGENT, updated_by: AGENT });

    const browserCard = await make(unique("authored browser"));
    expect(await getCard(browserCard.cardId)).toMatchObject({ created_by: null, updated_by: null });
    const patched = await app.inject({ method: "PATCH", url: `/api/cards/${browserCard.cardId}`, headers: KEY_HEADERS, payload: { content: "by agent" } });
    expect(patched.json()).toMatchObject({ created_by: null, updated_by: AGENT });
    const viaMcpUpdate = JSON.parse((await tool("update_card", { card_id: viaRest.json().id, content: "again" })).text);
    expect(viaMcpUpdate).toMatchObject({ created_by: AGENT, updated_by: AGENT });
  });

  it("leaves both empty for a browser (JWT/bypass) create", async () => {
    const res = await app.inject({ method: "POST", url: "/cards", payload: { title: unique("authored bypass") } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ created_by: null, updated_by: null });
  });
});

describe("a value that is not a UUID is a 400, not a 500", () => {
  const bad = "not-a-uuid";
  it.each([
    ["GET", `/tree/${bad}`, "node_id"],
    ["GET", `/tree/${bad}/children`, "node_id"],
    ["GET", `/tree/${bad}/compile`, "node_id"],
    ["GET", `/tree/${bad}/compile/sections`, "node_id"],
    ["PUT", `/tree/${bad}/move`, "node_id"],
    ["PATCH", `/tree/${bad}`, "node_id"],
    ["DELETE", `/tree/${bad}`, "node_id"],
    ["GET", `/cards/${bad}`, "card_id"],
    ["PUT", `/cards/${bad}`, "card_id"],
    ["DELETE", `/cards/${bad}`, "card_id"],
    ["GET", `/backlinks/${bad}`, "card_id"],
    ["GET", `/search?q=x&root_node_id=${bad}`, "root_node_id"],
    ["GET", `/search?q=x&rootNodeId=${bad}`, "root_node_id"],
  ] as const)("browser %s %s", async (method, url, label) => {
    const res = await app.inject({ method, url, payload: method === "GET" || method === "DELETE" ? undefined : {} });
    expect([res.statusCode, body(res)]).toEqual([400, { error: `Invalid ${label}: ${bad} (UUID expected)` }]);
  });

  it.each([
    ["GET", `/api/tree/${bad}/children`, "node_id"],
    ["GET", `/api/tree/${bad}/compile`, "node_id"],
    ["PATCH", `/api/cards/${bad}`, "card_id"],
  ] as const)("agent %s %s", async (method, url, label) => {
    const res = await app.inject({ method, url, headers: KEY_HEADERS, payload: method === "GET" ? undefined : {} });
    expect([res.statusCode, body(res)]).toEqual([400, { error: `Invalid ${label}: ${bad} (UUID expected)` }]);
  });

  it("also checks parent_node_id and card_id in a request body", async () => {
    const parent = await app.inject({ method: "POST", url: "/cards", payload: { title: "x", parent_node_id: bad } });
    expect([parent.statusCode, body(parent)]).toEqual([400, { error: `Invalid parent_node_id: ${bad} (UUID expected)` }]);
    const symlink = await app.inject({ method: "POST", url: "/tree/symlink", payload: { card_id: bad } });
    expect([symlink.statusCode, body(symlink)]).toEqual([400, { error: `Invalid card_id: ${bad} (UUID expected)` }]);
    const batch = await app.inject({ method: "POST", url: "/batch", payload: { symlinks: [{ card_id: bad, parent_node_id: null }] } });
    expect(batch.statusCode).toBe(400);
  });

  it("keeps other errors on Fastify's default handling", async () => {
    const a = await make(unique("cycle a"));
    const b = await make(unique("cycle b"), a.nodeId);
    const res = await app.inject({ method: "PUT", url: `/tree/${a.nodeId}/move`, payload: { parent_node_id: b.nodeId } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("TREE_CYCLE");
  });
});
