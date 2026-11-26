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
import { createNeighborsRoutes } from "../../src/api/routes/neighbors.js";
import { searchRoutes } from "../../src/api/routes/search.js";
import { treeRoutes } from "../../src/api/routes/tree.js";
import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import { closeDb, setDb } from "../../src/db/client.js";
import { insertAgent } from "../../src/db/queries/agents.js";
import { registerBatchTools } from "../../src/mcp/tools/batch_tools.js";
import { registerCardTools } from "../../src/mcp/tools/card_tools.js";
import { registerExpansionTools } from "../../src/mcp/tools/expansion_tools.js";
import { registerSearchTools } from "../../src/mcp/tools/search_tools.js";
import { registerTreeTools } from "../../src/mcp/tools/tree_tools.js";
import { FlatEmbeddingIndex } from "../../src/services/embeddings/flat-index.js";
import { createNeighborService } from "../../src/services/embeddings/neighbors.js";
import { createCard } from "../../src/services/card.service.js";

// Gaps found in review of the first errors-and-ids pass: neighbors, outline, Jev error shape,
// before/after, authentication order and IDs inside request bodies.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations-sqlite");
const KEY = "errors-review-key";
const KEY_HEADERS = { "x-api-key": KEY };
const UNKNOWN = "00000000-0000-4000-8000-000000000321";
const BAD = "not-a-uuid";
const AGENT = "errors-review-agent";
const originalEnv = { ...process.env };

const cardHint = (nodeId: string) => `This ID is a card_id (card content), but this tool takes a node_id (tree position). The card's node: ${nodeId}`;
const nodeHint = (cardId: string) => `This ID is a node_id (tree position), but this tool takes a card_id (card content). Its card_id: ${cardId}`;

let db: SqliteAdapter;
let app: FastifyInstance;
let mcp: Client;
let mcpServer: McpServer;
let seq = 0;

const unique = (prefix: string) => `${prefix} ${++seq}`;

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

const error = (res: { json(): unknown }) => (res.json() as { error: unknown }).error;

beforeAll(async () => {
  process.env["JWT_SECRET"] = "errors-review-secret";
  delete process.env["GOOGLE_CLIENT_ID"];
  delete process.env["SLACK_CLIENT_ID"];
  delete process.env["DASHBOARD_ADMIN_PASSWORD"];
  process.env["AUTH_BYPASS"] = "1";
  process.env["TYPESAFE_API_KEY"] = "jev-test-key";
  process.env["TYPESAFE_BASE_URL"] = "https://jev.example.test";
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
  const neighbors = createNeighborService(db, new FlatEmbeddingIndex());
  app = Fastify({ logger: false });
  await app.register(cookie);
  app.addHook("preHandler", authMiddleware);
  await app.register(cardRoutes);
  await app.register(treeRoutes);
  await app.register(searchRoutes);
  await app.register(batchRoutes);
  await app.register(cardApiRoutes);
  await app.register(createNeighborsRoutes(neighbors));

  mcpServer = new McpServer({ name: "errors-review", version: "1" });
  registerCardTools(mcpServer, AGENT);
  registerTreeTools(mcpServer);
  registerSearchTools(mcpServer);
  registerBatchTools(mcpServer, AGENT);
  registerExpansionTools(mcpServer, { neighbors });
  mcp = new Client({ name: "errors-review-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  await mcp.connect(clientTransport);
});

afterEach(async () => {
  await mcp.close();
  await mcpServer.close();
  await app.close();
});

describe("neighbors and outline name the ID kind in their not-found text", () => {
  it("get_card_neighbors and both REST neighbors routes keep CARD_NOT_FOUND and carry the shared text", async () => {
    const { cardId, nodeId } = await make(unique("neighbors probe"));
    const cases: Array<[string, string]> = [
      [UNKNOWN, `Card not found: ${UNKNOWN}`],
      [nodeId, `Card not found: ${nodeId}. ${nodeHint(cardId)}`],
    ];
    for (const [id, message] of cases) {
      const viaMcp = await tool("get_card_neighbors", { card_id: id });
      expect(viaMcp.isError).toBe(true);
      expect(JSON.parse(viaMcp.text).error).toMatchObject({ code: "CARD_NOT_FOUND", message });
      const browser = await app.inject({ method: "GET", url: `/cards/${id}/neighbors` });
      const agent = await app.inject({ method: "GET", url: `/api/cards/${id}/neighbors`, headers: KEY_HEADERS });
      for (const res of [browser, agent]) {
        expect(res.statusCode).toBe(404);
        expect(error(res)).toEqual({ code: "CARD_NOT_FOUND", message });
      }
    }
  });

  it("GET /tree/outline and /api/tree/outline name the node, with the hint for a card_id", async () => {
    const { cardId, nodeId } = await make(unique("outline probe"));
    const cases: Array<[string, string]> = [
      [UNKNOWN, `Node not found: ${UNKNOWN}`],
      [cardId, `Node not found: ${cardId}. ${cardHint(nodeId)}`],
    ];
    for (const [id, message] of cases) {
      const browser = await app.inject({ method: "GET", url: `/tree/outline?node_id=${id}` });
      const agent = await app.inject({ method: "GET", url: `/api/tree/outline?node_id=${id}`, headers: KEY_HEADERS });
      expect([browser.statusCode, error(browser)]).toEqual([404, message]);
      expect([agent.statusCode, error(agent)]).toEqual([404, message]);
    }
  });
});

describe("engine=jev keeps its coded errors for a bad root", () => {
  const jevUrl = (root: string) => `/search?q=anything&engine=jev&root_node_id=${root}`;

  it("keeps the codes: REST 404 JEV_ROOT_NOT_FOUND, REST 400 JEV_ROOT_INVALID, MCP toolError with the same code", async () => {
    const missing = await app.inject({ method: "GET", url: jevUrl(UNKNOWN) });
    expect(missing.statusCode).toBe(404);
    expect(error(missing)).toMatchObject({ code: "JEV_ROOT_NOT_FOUND" });
    const invalid = await app.inject({ method: "GET", url: jevUrl(BAD) });
    expect(invalid.statusCode).toBe(400);
    expect(error(invalid)).toMatchObject({ code: "JEV_ROOT_INVALID" });
    const viaMcp = await tool("search_cards", { query: "anything", engine: "jev", root_node_id: UNKNOWN });
    expect(viaMcp.isError).toBe(true);
    expect(JSON.parse(viaMcp.text).error).toMatchObject({ code: "JEV_ROOT_NOT_FOUND" });
  });

  it("carries the shared text with the ID-kind hint as the message", async () => {
    const { cardId, nodeId } = await make(unique("jev root probe"));
    const swapped = await app.inject({ method: "GET", url: jevUrl(cardId) });
    expect(error(swapped)).toEqual({ code: "JEV_ROOT_NOT_FOUND", message: `Node not found: ${cardId}. ${cardHint(nodeId)}` });
    const invalid = await app.inject({ method: "GET", url: jevUrl(BAD) });
    expect(error(invalid)).toEqual({ code: "JEV_ROOT_INVALID", message: `Invalid root_node_id: ${BAD} (UUID expected)` });
    const viaMcp = await tool("search_cards", { query: "anything", engine: "jev", root_node_id: cardId });
    expect(JSON.parse(viaMcp.text).error).toEqual({ code: "JEV_ROOT_NOT_FOUND", message: `Node not found: ${cardId}. ${cardHint(nodeId)}` });
  });
});

describe("before and after must name a child of the target parent", () => {
  const rule = (field: string, id: string) => `Invalid ${field}: ${id} is not a child of the target parent`;

  it.each(["before", "after"] as const)("%s: unknown ID and a node under another parent give 400 on MCP, REST and batch", async (field) => {
    const parent = await make(unique("position parent"));
    const mover = await make(unique("position mover"), parent.nodeId);
    const elsewhere = await make(unique("position elsewhere"));
    for (const id of [UNKNOWN, elsewhere.nodeId]) {
      const viaMcp = await tool("move_node", { node_id: mover.nodeId, [field]: id });
      expect(viaMcp.isError).toBe(true);
      expect(viaMcp.text).toContain(rule(field, id));
      expect(viaMcp.text).toContain(parent.nodeId);

      const viaRest = await app.inject({ method: "PUT", url: `/tree/${mover.nodeId}/move`, payload: { [field]: id } });
      expect(viaRest.statusCode).toBe(400);
      expect(error(viaRest)).toBe(viaMcp.text);

      const batchItem = { node_id: mover.nodeId, [field]: id };
      const batchMcp = await tool("batch_op", { moves: [batchItem] });
      expect(batchMcp).toEqual({ isError: true, text: viaMcp.text });
      const batchRest = await app.inject({ method: "POST", url: "/batch", payload: { moves: [batchItem] } });
      expect([batchRest.statusCode, error(batchRest)]).toEqual([400, viaMcp.text]);
    }
  });

  it("still accepts a real sibling", async () => {
    const parent = await make(unique("position ok parent"));
    const first = await make(unique("position first"), parent.nodeId);
    const second = await make(unique("position second"), parent.nodeId);
    const res = await app.inject({ method: "PUT", url: `/tree/${second.nodeId}/move`, payload: { before: first.nodeId } });
    expect(res.statusCode).toBe(200);
  });
});

describe("authentication comes before ID format", () => {
  it.each([
    ["GET", `/api/tree/${BAD}/children`],
    ["GET", `/api/tree/${BAD}/compile`],
    ["GET", `/api/tree/outline?node_id=${BAD}`],
    ["PATCH", `/api/cards/${BAD}`],
    ["POST", "/api/cards"],
  ] as const)("agent %s %s without a key is 401", async (method, url) => {
    const res = await app.inject({ method, url, payload: method === "GET" ? undefined : { title: "x", parent_node_id: BAD } });
    expect(res.statusCode).toBe(401);
  });

  it("a wrong key is 401 too, and a right key gets the 400", async () => {
    const wrong = await app.inject({ method: "GET", url: `/api/tree/${BAD}/children`, headers: { "x-api-key": "wrong" } });
    expect(wrong.statusCode).toBe(401);
    const right = await app.inject({ method: "GET", url: `/api/tree/${BAD}/children`, headers: KEY_HEADERS });
    expect([right.statusCode, error(right)]).toEqual([400, `Invalid node_id: ${BAD} (UUID expected)`]);
  });

  it("a dashboard request without a login is 401 whatever the ID looks like", async () => {
    delete process.env["AUTH_BYPASS"];
    try {
      for (const url of [`/tree/${BAD}/children`, `/cards/${BAD}`, `/tree/${UNKNOWN}/children`]) {
        expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
      }
    } finally {
      process.env["AUTH_BYPASS"] = "1";
    }
  });
});

describe("IDs inside request bodies are checked before the database", () => {
  const invalid = (label: string) => `Invalid ${label}: ${BAD} (UUID expected)`;

  it("card references on every REST create and update, and compile/contents card_ids", async () => {
    const { cardId } = await make(unique("body ids card"));
    const cases: Array<[string, string, Record<string, unknown>, string, Record<string, string>?]> = [
      ["POST", "/cards", { title: "x", references: [BAD] }, "references[0]"],
      ["PUT", `/cards/${cardId}`, { references: [BAD] }, "references[0]"],
      ["POST", "/api/cards", { title: "x", references: [BAD] }, "references[0]", KEY_HEADERS],
      ["POST", "/tree/compile/contents", { card_ids: [cardId, BAD] }, "card_ids[1]"],
    ];
    for (const [method, url, payload, label, headers] of cases) {
      const res = await app.inject({ method: method as "POST" | "PUT", url, payload, headers });
      expect([url, res.statusCode, error(res)]).toEqual([url, 400, invalid(label)]);
    }
    const stored = await db.query(`SELECT COUNT(*) AS n FROM cards WHERE title = 'x'`);
    expect(Number(stored.rows[0]["n"])).toBe(0);
  });

  it("every ID field of a batch is checked and nothing in the batch is applied", async () => {
    const { cardId, nodeId } = await make(unique("batch body ids"));
    const createdTitle = unique("batch body rolled back");
    const scenarios: Array<[string, Record<string, unknown>]> = [
      ["creates[0].references[0]", { creates: [{ temp_id: "r", card_type: "knowledge", title: "r", references: [BAD] }] }],
      ["updates[0].card_id", { updates: [{ card_id: BAD, title: "t" }] }],
      ["updates[0].references[0]", { updates: [{ card_id: cardId, references: [BAD] }] }],
      ["node_updates[0].node_id", { node_updates: [{ node_id: BAD, journal_limit: 1 }] }],
      ["moves[0].node_id", { moves: [{ node_id: BAD, new_parent_node_id: null }] }],
      ["child_orders[0].order[1]", { child_orders: [{ parent_node_id: null, order: [nodeId, BAD] }] }],
      ["deletes[0].card_id", { deletes: [{ card_id: BAD }] }],
    ];
    for (const [label, ops] of scenarios) {
      const batch = { creates: [{ temp_id: "ok", card_type: "knowledge", title: createdTitle }], ...ops };
      const res = await app.inject({ method: "POST", url: "/batch", payload: batch });
      expect([label, res.statusCode, error(res)]).toEqual([label, 400, invalid(label)]);
    }
    const leftovers = await db.query("SELECT COUNT(*) AS n FROM cards WHERE title = $1", [createdTitle]);
    expect(Number(leftovers.rows[0]["n"])).toBe(0);
    expect((await db.query("SELECT COUNT(*) AS n FROM cards WHERE id = $1", [cardId])).rows[0]["n"]).toBe(1);
  });
});
