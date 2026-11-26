import path from "path";
import { fileURLToPath } from "url";

import bcrypt from "bcryptjs";
import Fastify, { type FastifyInstance } from "fastify";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { agentKeyVerifier } from "../../src/api/agent-key-auth.js";
import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import { setDb } from "../../src/db/client.js";
import { insertAgent } from "../../src/db/queries/agents.js";
import { registerAllTools } from "../../src/mcp/register-tools.js";
import { createScopedMcpServer, explainDisabledWriteTools } from "../../src/mcp/tool-scope.js";
import { createCard } from "../../src/services/card.service.js";
import type { AgentScope } from "../../src/shared/types.js";

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/db/migrations-sqlite");

export const WRITE_KEY = "harness-write-key";
export const READ_KEY = "harness-read-key";
export const WRITE_HEADERS = { "x-api-key": WRITE_KEY };
export const READ_HEADERS = { "x-api-key": READ_KEY };
export const UNKNOWN_ID = "00000000-0000-4000-8000-000000000123";

/** An in-memory SQLite database with one write-scope and one read-scope agent key. */
export async function openMemoryDb(): Promise<SqliteAdapter> {
  const db = new SqliteAdapter(":memory:");
  setDb(db);
  await db.runMigrations(MIGRATIONS_DIR);
  await insertAgent(db, { agent_id: "harness-writer", secret_hash: await bcrypt.hash(WRITE_KEY, 4), scope: "write" });
  await insertAgent(db, { agent_id: "harness-reader", secret_hash: await bcrypt.hash(READ_KEY, 4), scope: "read" });
  agentKeyVerifier.clear();
  return db;
}

/** A Fastify app whose requests without an API key count as the logged-in dashboard user (bypass mode). */
export function browserApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.addHook("preHandler", async (request) => {
    if (request.headers["x-api-key"]) return;
    request.jwtUser = { id: "bypass", email: "bypass@local", name: "Bypass Admin", role: "admin" };
  });
  return app;
}

export interface McpSession {
  client: Client;
  call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }>;
  close(): Promise<void>;
}

/** The tools an MCP client sees for a key of the given scope, wired as POST /mcp wires them. */
export async function openMcp(scope: AgentScope): Promise<McpSession> {
  const server = new McpServer({ name: "harness", version: "1" });
  registerAllTools(createScopedMcpServer(server, scope), { agentId: "harness-agent", scope, neighbors: null });
  explainDisabledWriteTools(server, scope);
  const client = new Client({ name: "harness-client", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    async call(name, args) {
      const result = await client.callTool({ name, arguments: args });
      const content = result.content as Array<{ text: string }>;
      return { isError: result.isError === true, text: content[0]?.text ?? "" };
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}

export async function makeCard(title: string, parentNodeId: string | null = null, content = `body ${title}`) {
  const created = await createCard({ card_type: "knowledge", title, content, parent_node_id: parentNodeId });
  return { cardId: created.card.id, nodeId: created.node_id };
}
