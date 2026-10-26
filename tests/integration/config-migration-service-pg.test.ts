import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import { migrateSqliteToPostgres } from "../../src/api/config/migration-service.js";
import { getIntegrationTestPool, setupIntegrationTestDb } from "./integration-harness.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceUser = "10000000-0000-4000-8000-000000000001";
const seedUser = "10000000-0000-4000-8000-000000000002";
const agentId = "20000000-0000-4000-8000-000000000001";
const cardId = "30000000-0000-4000-8000-000000000001";
const nodeId = "40000000-0000-4000-8000-000000000001";
const email = "migration@example.test";
let temp: string;
let sqlitePath: string;
setupIntegrationTestDb();

beforeEach(async () => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "atom-pg-migration-"));
  sqlitePath = path.join(temp, "source.db");
  const source = new SqliteAdapter(sqlitePath);
  try {
    await source.runMigrations(path.join(root, "src/db/migrations-sqlite"));
    await source.query("INSERT INTO users (id, email, display_name, role, is_active) VALUES ($1, $2, 'Source admin', 'admin', 0)", [sourceUser, email]);
    await source.query("INSERT INTO agents (id, agent_id, secret_hash, created_by) VALUES ($1, 'source-agent', 'hash', $2)", [agentId, sourceUser]);
    await source.query("INSERT INTO cards (id, card_type, title) VALUES ($1, 'knowledge', 'Source card')", [cardId]);
    await source.query("INSERT INTO tree_nodes (id, card_id, position) VALUES ($1, $2, '0000000001')", [nodeId, cardId]);
  } finally {
    await source.close();
  }
  const pg = getIntegrationTestPool();
  await pg.query("INSERT INTO users (id, email, display_name, role) VALUES ($1, $2, 'Seed admin', 'admin')", [seedUser, email]);
});

afterEach(() => {
  fs.rmSync(temp, { recursive: true, force: true });
});

function migrate() {
  return migrateSqliteToPostgres({
    db: getIntegrationTestPool(),
    getSqlitePath: () => sqlitePath,
    existsSync: fs.existsSync,
    openSqliteReadonly: filename => new Database(filename, { readonly: true }),
    renameSync: fs.renameSync,
  });
}

it("replaces a same-email seed with the SQLite user and preserves existing agent references", async () => {
  const pg = getIntegrationTestPool();
  // The copied agent already exists in PG and refers to the seed user.
  await pg.query("INSERT INTO agents (id, agent_id, secret_hash, created_by) VALUES ($1, 'source-agent', 'hash', $2)", [agentId, seedUser]);
  expect(await migrate()).toEqual({ ok: true });
  expect(fs.existsSync(sqlitePath)).toBe(false);
  expect(fs.existsSync(sqlitePath + ".deprecated")).toBe(true);
  const source = new Database(sqlitePath + ".deprecated", { readonly: true });
  try {
    for (const table of ["users", "agents", "cards", "tree_nodes"]) {
      const expected = source.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number };
      const result = await pg.query(`SELECT count(*) AS count FROM ${table}`);
      expect(Number(result.rows[0]["count"])).toBe(expected.count);
    }
  } finally {
    source.close();
  }
  expect((await pg.query("SELECT id, display_name, is_active FROM users")).rows)
    .toEqual([{ id: sourceUser, display_name: "Source admin", is_active: false }]);
  expect((await pg.query("SELECT created_by FROM agents")).rows).toEqual([{ created_by: sourceUser }]);
  expect((await pg.query("SELECT id, card_id FROM tree_nodes")).rows).toEqual([{ id: nodeId, card_id: cardId }]);
});

it("rolls back the seed replacement and all copies when a later row fails", async () => {
  const source = new Database(sqlitePath);
  try {
    source.prepare("INSERT INTO cards (id, card_type, title) VALUES ('invalid-pg-uuid', 'knowledge', 'Invalid card')").run();
  } finally {
    source.close();
  }
  const pg = getIntegrationTestPool();
  await pg.query("INSERT INTO agents (id, agent_id, secret_hash, created_by) VALUES ($1, 'source-agent', 'hash', $2)", [agentId, seedUser]);
  expect(await migrate()).toEqual({ ok: false, statusCode: 500, error: expect.stringContaining("invalid input syntax for type uuid") });
  expect((await pg.query("SELECT id, display_name FROM users")).rows).toEqual([{ id: seedUser, display_name: "Seed admin" }]);
  expect((await pg.query("SELECT created_by FROM agents")).rows).toEqual([{ created_by: seedUser }]);
  expect((await pg.query("SELECT id FROM cards")).rows).toEqual([]);
  expect((await pg.query("SELECT id FROM tree_nodes")).rows).toEqual([]);
  expect(fs.existsSync(sqlitePath)).toBe(true);
  expect(fs.existsSync(sqlitePath + ".deprecated")).toBe(false);
});
