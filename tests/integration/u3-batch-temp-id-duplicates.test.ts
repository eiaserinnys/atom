import path from "node:path";
import { fileURLToPath } from "node:url";

import Fastify, { type FastifyInstance } from "fastify";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { closeDb, getDb, runMigrations, setDb } from "../../src/db/client.js";
import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import { batchRoutes } from "../../src/api/routes/batch.js";
import { registerBatchTools } from "../../src/mcp/tools/batch_tools.js";
import { executeBatchOp } from "../../src/services/batch.service.js";
import { createCard, getCard } from "../../src/services/card.service.js";
import type { BatchCreateItem } from "../../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS_DIR = path.join(root, "src/db/migrations-sqlite");

let app: FastifyInstance | undefined;
let client: Client | undefined;
let server: McpServer | undefined;

beforeEach(async () => {
  setDb(new SqliteAdapter(":memory:"));
  await runMigrations(MIGRATIONS_DIR);
});

afterEach(async () => {
  if (client) await client.close();
  if (server) await server.close();
  if (app) await app.close();
  client = undefined;
  server = undefined;
  app = undefined;
  await closeDb();
});

function duplicateCreates(): BatchCreateItem[] {
  return [
    { temp_id: "duplicate-u3", card_type: "knowledge", title: "First duplicate" },
    { temp_id: "duplicate-u3", card_type: "knowledge", title: "Second duplicate" },
  ];
}

describe("U3 duplicate batch temp_id rejection", () => {
  it("rejects duplicate temp_ids with a coded HTTP 400 and MCP error before any write", async () => {
    const creates = duplicateCreates();
    app = Fastify({ logger: false });
    await app.register(batchRoutes);
    server = new McpServer({ name: "u3-batch-test", version: "1" });
    registerBatchTools(server, "u3-test");
    client = new Client({ name: "u3-batch-client", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const response = await app.inject({ method: "POST", url: "/batch", payload: { creates } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "DUPLICATE_TEMP_ID",
      message: expect.stringContaining("duplicate-u3"),
    });

    const mcpResult = await client.callTool({ name: "batch_op", arguments: { creates } });
    expect(mcpResult.isError).toBe(true);
    expect(JSON.stringify(mcpResult)).toContain("duplicate-u3");
    expect((await getDb().query("SELECT COUNT(*) AS n FROM cards")).rows[0].n.toString()).toBe("0");
  });

  it("rejects duplicated parents even when a create references the duplicate temp_id", async () => {
    const creates: BatchCreateItem[] = [
      ...duplicateCreates(),
      {
        temp_id: "child-u3",
        card_type: "knowledge",
        title: "Child referencing duplicate",
        parent_temp_id: "duplicate-u3",
      },
    ];

    await expect(executeBatchOp({ creates })).rejects.toMatchObject({
      code: "DUPLICATE_TEMP_ID",
      statusCode: 400,
      message: expect.stringContaining("duplicate-u3"),
    });
    expect((await getDb().query("SELECT COUNT(*) AS n FROM cards")).rows[0].n.toString()).toBe("0");
  });

  it("rolls back a mixed update when creates contain duplicate temp_ids", async () => {
    const existing = await createCard({ card_type: "knowledge", title: "Keep this title" });
    const before = await getDb().query("SELECT id, title FROM cards ORDER BY id");

    await expect(executeBatchOp({
      creates: duplicateCreates(),
      updates: [{ card_id: existing.card.id, title: "Must roll back" }],
    })).rejects.toMatchObject({
      code: "DUPLICATE_TEMP_ID",
      statusCode: 400,
      message: expect.stringContaining("duplicate-u3"),
    });

    expect(await getCard(existing.card.id)).toMatchObject({ title: "Keep this title" });
    expect((await getDb().query("SELECT id, title FROM cards ORDER BY id")).rows).toEqual(before.rows);
  });
});
