import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import Fastify from "fastify";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import { PostgresAdapter } from "../../src/db/adapters/postgres.js";
import { closeDb, getDb, setDb } from "../../src/db/client.js";
import { insertCard } from "../../src/db/queries/cards.js";
import { getNodeBreadcrumb, insertNode, selectNodeById } from "../../src/db/queries/tree.js";
import { searchByBm25 } from "../../src/db/queries/search.js";
import { getNeighborPathRows } from "../../src/db/queries/embedding-neighbors.js";
import { moveNode, createSymlink } from "../../src/services/tree.service.js";
import { executeBatchOp } from "../../src/services/batch.service.js";
import { treeRoutes } from "../../src/api/routes/tree.js";
import { batchRoutes } from "../../src/api/routes/batch.js";
import { registerTreeTools } from "../../src/mcp/tools/tree_tools.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe.each(["sqlite", "postgres"] as const)("tree cycle protection (%s)", (kind) => {
  let tempDir: string;
  let dbPath: string;
  let databaseWasEmpty = false;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tree-cycle-test-"));
    dbPath = path.join(tempDir, "cycle_test.db");
    if (kind === "sqlite") {
      setDb(new SqliteAdapter(dbPath));
    } else {
      const url = process.env["TEST_DATABASE_URL"];
      if (!url || !url.includes("test")) {
        throw new Error("Tree cycle tests require TEST_DATABASE_URL pointing to an empty test database (URL must contain 'test')");
      }
      setDb(new PostgresAdapter(url));
    }
    await getDb().runMigrations(path.join(root, "src/db", kind === "sqlite" ? "migrations-sqlite" : "migrations"));
    expect((await getDb().query("SELECT COUNT(*) AS n FROM cards")).rows[0].n.toString()).toBe("0");
    databaseWasEmpty = true;
  });

  afterEach(async () => {
    if (!databaseWasEmpty) return;
    await getDb().query("DELETE FROM tree_nodes");
    await getDb().query("DELETE FROM cards");
  });

  afterAll(async () => {
    await closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function node(title: string, parent: string | null = null) {
    const card = await insertCard(getDb(), { card_type: "knowledge", title, content: "cycleneedle" });
    return insertNode(getDb(), card.id, parent, undefined);
  }

  async function snapshot() {
    return (await getDb().query("SELECT id, parent_node_id, position FROM tree_nodes ORDER BY id")).rows;
  }

  it.each(["self", "descendant"])("rejects moving below %s without any writes", async (target) => {
    const a = await node("A");
    const b = await node("B", a.id);
    const before = await snapshot();
    await expect(moveNode(a.id, { parent_node_id: target === "self" ? a.id : b.id }))
      .rejects.toMatchObject({ code: "TREE_CYCLE", statusCode: 400 });
    expect(await snapshot()).toEqual(before);
  });

  it.each(["moves", "child_orders", "mixed"])("rolls back the entire %s batch when its final topology cycles", async (mode) => {
    const a = await node("A");
    const b = await node("B");
    const before = await snapshot();
    const input = mode === "moves"
      ? { moves: [{ node_id: a.id, new_parent_node_id: b.id }, { node_id: b.id, new_parent_node_id: a.id }] }
      : mode === "child_orders"
        ? { child_orders: [{ parent_node_id: b.id, order: [a.id] }, { parent_node_id: a.id, order: [b.id] }] }
        : { moves: [{ node_id: a.id, new_parent_node_id: b.id }], child_orders: [{ parent_node_id: a.id, order: [b.id] }] };
    await expect(executeBatchOp({ ...input, creates: [{ temp_id: "new", title: "Rolled back", card_type: "knowledge" }] }))
      .rejects.toMatchObject({ code: "TREE_CYCLE" });
    expect(await snapshot()).toEqual(before);
    expect((await getDb().query("SELECT COUNT(*) AS n FROM cards")).rows[0].n.toString()).toBe("2");
  });

  it("rejects the reported child_orders ancestor-to-descendant move", async () => {
    const a = await node("A");
    const b = await node("B", a.id);
    const before = await snapshot();
    await expect(executeBatchOp({ child_orders: [{ parent_node_id: b.id, order: [a.id] }] }))
      .rejects.toMatchObject({ code: "TREE_CYCLE" });
    expect(await snapshot()).toEqual(before);
  });

  it("accepts a batch whose child_orders resolves a temporary cycle", async () => {
    const a = await node("A");
    const b = await node("B", a.id);
    await executeBatchOp({ moves: [{ node_id: a.id, new_parent_node_id: b.id }], child_orders: [{ parent_node_id: null, order: [b.id] }] });
    expect((await selectNodeById(getDb(), a.id))?.parent_node_id).toBe(b.id);
    expect((await selectNodeById(getDb(), b.id))?.parent_node_id).toBeNull();
    await expect(moveNode(a.id, { parent_node_id: null })).resolves.toMatchObject({ node: { parent_node_id: null } });
  });

  it("checks physical parents without expanding symlink card references", async () => {
    const a = await node("A");
    const alias = await createSymlink(a.card_id, null);
    await expect(moveNode(a.id, { parent_node_id: alias.id })).resolves.toMatchObject({ node: { parent_node_id: alias.id } });
  });

  it("returns HTTP 400 and a coded MCP tool error", async () => {
    const a = await node("A");
    const b = await node("B", a.id);
    const app = Fastify();
    await app.register(treeRoutes);
    await app.register(batchRoutes);
    try {
      const response = await app.inject({ method: "PUT", url: `/tree/${a.id}/move`, payload: { parent_node_id: b.id } });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("TREE_CYCLE");
      const batch = await app.inject({ method: "POST", url: "/batch", payload: { child_orders: [{ parent_node_id: b.id, order: [a.id] }] } });
      expect(batch.statusCode).toBe(400);
      expect(batch.json().code).toBe("TREE_CYCLE");
      const handlers = new Map<string, (args: unknown) => Promise<any>>();
      registerTreeTools({ tool(name: string, _description: string, _schema: unknown, handler: (args: unknown) => Promise<any>) { handlers.set(name, handler); } } as unknown as McpServer, "test");
      const result = await handlers.get("move_node")!({ node_id: a.id, parent_node_id: b.id });
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).error.code).toBe("TREE_CYCLE");
    } finally {
      await app.close();
    }
  });

  it.each(["breadcrumb", "search", "neighbors"])("terminates %s on an already cyclic database", async (mode) => {
    const a = await node("A");
    const b = await node("B", a.id);
    expect(await getNodeBreadcrumb(getDb(), b.id)).toEqual(["A", "B"]);
    await getDb().query("UPDATE tree_nodes SET parent_node_id = $1 WHERE id = $2", [b.id, a.id]);
    let result: unknown;
    if (kind === "sqlite") {
      const workerEnv = { ...process.env };
      delete workerEnv["DATABASE_URL"];
      const child = spawnSync(process.execPath, ["--import", "tsx", path.join(root, "tests/integration/tree-cycle-query-worker.ts"), dbPath, b.id, mode], { cwd: root, env: workerEnv, encoding: "utf8", timeout: 2500, maxBuffer: 1024 * 1024 });
      expect(child.error).toBeUndefined();
      expect(child.status).toBe(0);
      result = JSON.parse(child.stdout);
    } else {
      result = await getDb().transaction(async (client) => {
        await client.query("SET LOCAL statement_timeout = '2000ms'");
        if (mode === "neighbors") return getNeighborPathRows(client, [b.card_id]);
        return mode === "search" ? searchByBm25(client, { query: "cycleneedle", root_node_id: b.id }) : getNodeBreadcrumb(client, b.id);
      });
    }
    if (mode === "breadcrumb") expect(result).toEqual(["A", "B"]);
    else expect(result).toHaveLength(2);
  });
});
