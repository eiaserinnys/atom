/**
 * Real browser/MCP entry points and card rows, following api-server-permissions
 * and api-agent-key-cache. A local adapter resolves without external requests.
 */
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { jest } from "@jest/globals";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { authMiddleware } from "../../src/api/middleware/auth.js";
import { agentKeyVerifier } from "../../src/api/agent-key-auth.js";
import { treeRoutes } from "../../src/api/routes/tree.js";
import { mcpRoutes } from "../../src/api/routes/mcp.js";
import { insertUser } from "../../src/db/queries/users.js";
import { insertAgent } from "../../src/db/queries/agents.js";
import { createCard } from "../../src/services/card.service.js";
import { registerTreeTools } from "../../src/mcp/tools/tree_tools.js";
import { adapterRegistry } from "../../src/unfurl/registry.js";
import type { UserRole } from "../../src/shared/types.js";
import { getIntegrationTestPool, setupIntegrationTestDb } from "./integration-harness.js";

setupIntegrationTestDb();

const originalEnv = { ...process.env };
const JWT_SECRET = "compile-readonly-test-secret";
const snapshot = (text: string) => JSON.stringify({ text, unfurlData: { text } });
const freshSnapshot = snapshot("live response");
const callers = ["viewer", "editor", "admin", "read", "write"] as const;
type Caller = typeof callers[number];
const cases = [
  { name: "fresh snapshot", mode: "fresh", sourceType: "p4-ref", cached: snapshot("old response"), fails: false },
  { name: "cached miss", mode: "cached", sourceType: "p4-ref", cached: null, fails: false },
  { name: "source_type repair with cached hit", mode: "cached", sourceType: "link", cached: snapshot("cached response"), fails: false },
  { name: "source_type repair when resolution fails", mode: "cached", sourceType: "link", cached: null, fails: true },
] as const;
let app: FastifyInstance;

beforeAll(() => {
  process.env["JWT_SECRET"] = JWT_SECRET;
  process.env["GOOGLE_CLIENT_ID"] = "compile-test-client";
  delete process.env["SLACK_CLIENT_ID"];
  delete process.env["AUTH_BYPASS"];
  adapterRegistry.register({
    sourceType: "p4-ref",
    credentialFields: [],
    canHandle: ref => ref.startsWith("p4://"),
    resolve: async ref => {
      if (ref.endsWith("missing")) throw new Error("test reference unavailable");
      return { text: "live response", snapshot: freshSnapshot, unfurlData: { text: "live response" } };
    },
  });
});

afterAll(() => { process.env = { ...originalEnv }; });

beforeEach(async () => {
  agentKeyVerifier.clear();
  app = Fastify({ logger: false });
  await app.register(cookie);
  app.addHook("preHandler", authMiddleware);
  await app.register(treeRoutes);
  await app.register(mcpRoutes, {
    neighborService: {
      get: async () => ({ statusCode: 503, body: { error: { code: "INDEX_UNAVAILABLE" } } }),
      waitForLoad: async () => undefined,
    },
  });
  // The MCP transport uses raw streams; use the real socket as in api-agent-key-cache.
  await app.listen({ port: 0, host: "127.0.0.1" });
});

afterEach(async () => { await app.close(); });

async function compile(caller: Caller, nodeId: string, mode: string): Promise<string> {
  if (caller === "read" || caller === "write") {
    const secret = "compile-test-key";
    await insertAgent(getIntegrationTestPool(), {
      agent_id: "compile-test-agent", scope: caller, secret_hash: await bcrypt.hash(secret, 4),
    });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("server is not listening");
    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: {
        "x-api-key": secret, "content-type": "application/json",
        accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-03-26",
      },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "tools/call",
        params: { name: "compile_subtree", arguments: { node_id: nodeId, resolve_refs: mode } },
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.text();
    const data = body.split("\n").find(line => line.startsWith("data:"));
    const rpc = JSON.parse(data ? data.slice(5).trim() : body);
    expect(rpc.error).toBeUndefined();
    expect(rpc.result.isError).not.toBe(true);
    return rpc.result.content[0].text;
  }
  const user = await insertUser(getIntegrationTestPool(), {
    email: "compile-user@example.test", role: caller as UserRole,
  });
  const token = await new SignJWT({ id: user.id, role: caller })
    .setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h")
    .sign(new TextEncoder().encode(JWT_SECRET));
  const response = await app.inject({
    method: "POST", url: `/tree/${nodeId}/compile`,
    headers: { cookie: `atom_auth=${token}` },
    // A payload cannot grant persistence to a viewer.
    payload: { resolveRefs: mode, canWriteRefs: true },
  });
  expect(response.statusCode).toBe(200);
  return response.json().markdown;
}

describe.each(callers)("compile persistence for %s", caller => {
  it.each(cases)("$name", async scenario => {
    const db = getIntegrationTestPool();
    const { card, node_id: nodeId } = await createCard({
      card_type: "knowledge", title: "External reference",
      source_type: scenario.sourceType, source_ref: scenario.fails ? "p4://missing" : "p4://item",
    });
    await db.query("UPDATE cards SET source_snapshot = $1 WHERE id = $2", [scenario.cached, card.id]);
    const before = (await db.query("SELECT * FROM cards WHERE id = $1", [card.id])).rows[0];
    const queries = jest.spyOn(db, "query");
    try {
      const markdown = await compile(caller, nodeId, scenario.mode);
      expect(markdown).toContain(scenario.fails ? "unfurl failed: link" :
        scenario.cached && scenario.mode === "cached" ? "cached response" : "live response");
      // Finish all fire-and-forget DB operations initiated by this response.
      await Promise.all(queries.mock.results.filter(result => result.type === "return").map(result => result.value));
      const mutations = queries.mock.calls.filter(([sql]) => /^\s*UPDATE cards\b/i.test(sql));
      const after = (await db.query("SELECT * FROM cards WHERE id = $1", [card.id])).rows[0];
      if (caller === "viewer" || caller === "read") {
        expect(after).toEqual(before);
        expect(mutations).toHaveLength(0);
      } else {
        expect(mutations.length).toBeGreaterThan(0);
        expect(after.source_type).toBe("p4-ref");
        expect(after.source_snapshot).toBe(
          scenario.fails ? null : scenario.mode === "cached" && scenario.cached ? scenario.cached : freshSnapshot,
        );
      }
    } finally {
      queries.mockRestore();
    }
  });
});

it("does not persist a fresh snapshot from the viewer section compile POST", async () => {
  const db = getIntegrationTestPool();
  const user = await insertUser(db, {
    email: "compile-sections-viewer@example.test", role: "viewer",
  });
  const { card, node_id: nodeId } = await createCard({
    card_type: "knowledge", title: "External section reference",
    source_type: "p4-ref", source_ref: "p4://item",
  });
  const cachedSnapshot = snapshot("old response");
  await db.query("UPDATE cards SET source_snapshot = $1 WHERE id = $2", [cachedSnapshot, card.id]);
  const before = (await db.query("SELECT * FROM cards WHERE id = $1", [card.id])).rows[0];
  const token = await new SignJWT({ id: user.id, role: "viewer" })
    .setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h")
    .sign(new TextEncoder().encode(JWT_SECRET));
  const queries = jest.spyOn(db, "query");
  try {
    const response = await app.inject({
      method: "POST", url: `/tree/${nodeId}/compile/sections`,
      headers: { cookie: `atom_auth=${token}` },
      payload: { resolveRefs: "fresh", head_chars: 200000, canWriteRefs: true },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().sections[0].unfurl_text).toBe("live response");
    await Promise.all(queries.mock.results
      .filter(result => result.type === "return")
      .map(result => result.value));
    const mutations = queries.mock.calls.filter(([sql]) => /^\s*UPDATE cards\b/i.test(sql));
    const after = (await db.query("SELECT * FROM cards WHERE id = $1", [card.id])).rows[0];
    expect(after).toEqual(before);
    expect(mutations).toHaveLength(0);
  } finally {
    queries.mockRestore();
  }
});

it("keeps stdio registration writable when no HTTP key scope is supplied", async () => {
  const { card, node_id: nodeId } = await createCard({
    card_type: "knowledge", title: "Stdio reference", source_type: "p4-ref", source_ref: "p4://item",
  });
  let handler: ((args: unknown) => Promise<unknown>) | undefined;
  const server = { tool: (name: string, _description: string, _schema: unknown, callback: typeof handler) => {
    if (name === "compile_subtree") handler = callback;
  } } as unknown as McpServer;
  registerTreeTools(server, "stdio-agent");
  expect(handler).toBeDefined();
  const db = getIntegrationTestPool();
  const queries = jest.spyOn(db, "query");
  try {
    await handler!({ node_id: nodeId, resolve_refs: "cached" });
    await Promise.all(queries.mock.results.filter(result => result.type === "return").map(result => result.value));
    expect((await db.query("SELECT source_snapshot FROM cards WHERE id = $1", [card.id])).rows[0].source_snapshot)
      .toBe(freshSnapshot);
  } finally { queries.mockRestore(); }
});
