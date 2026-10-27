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
  const deps = {
    db: getIntegrationTestPool(),
    getSqlitePath: () => sqlitePath,
    existsSync: fs.existsSync,
    checkpointSqlite,
    openSqliteReadonly: (filename: string) => new Database(filename, { readonly: true }),
    renameSync: fs.renameSync,
  };
  return migrateSqliteToPostgres(deps as unknown as Parameters<typeof migrateSqliteToPostgres>[0]);
}

function checkpointSqlite(filename: string): { busy: number } {
  const source = new Database(filename);
  try {
    const rows = source.pragma("wal_checkpoint(TRUNCATE)") as Array<{ busy: number }>;
    return { busy: Number(rows[0]?.busy ?? 0) };
  } finally {
    source.close();
  }
}

it("rejects a rootless cycle and orphan without changing PostgreSQL or renaming SQLite", async () => {
  const cycleA = "40000000-0000-4000-8000-000000000002";
  const cycleB = "40000000-0000-4000-8000-000000000003";
  const orphan = "40000000-0000-4000-8000-000000000004";
  const source = new Database(sqlitePath);
  try {
    source.pragma("foreign_keys = OFF");
    const insert = source.prepare(
      "INSERT INTO tree_nodes (id, card_id, parent_node_id, position, is_symlink, created_at) VALUES (?, ?, ?, ?, 0, ?)"
    );
    insert.run(cycleA, cardId, cycleB, "0000000002", "2026-05-24T00:09:00.000Z");
    insert.run(cycleB, cardId, cycleA, "0000000003", "2026-05-24T00:10:00.000Z");
    insert.run(orphan, cardId, "40000000-0000-4000-8000-000000000005", "0000000004", "2026-05-24T00:11:00.000Z");
  } finally {
    source.close();
  }

  const pg = getIntegrationTestPool();
  const result = await migrate();

  expect(result).toMatchObject({ ok: false, statusCode: 400 });
  if (!result.ok) {
    expect(result.error).toContain("3");
    expect(result.error).toContain(cycleA);
    expect(result.error).toContain(cycleB);
    expect(result.error).toContain(orphan);
  }
  expect((await pg.query("SELECT id FROM users")).rows).toEqual([{ id: seedUser }]);
  expect((await pg.query("SELECT id FROM agents")).rows).toEqual([]);
  expect((await pg.query("SELECT id FROM cards")).rows).toEqual([]);
  expect((await pg.query("SELECT id FROM tree_nodes")).rows).toEqual([]);
  expect(fs.existsSync(sqlitePath)).toBe(true);
  expect(fs.existsSync(sqlitePath + ".deprecated")).toBe(false);
});

it("rejects a lone orphan and preserves the source", async () => {
  const orphan = "40000000-0000-4000-8000-000000000006";
  const source = new Database(sqlitePath);
  try {
    source.pragma("foreign_keys = OFF");
    source.prepare(
      "INSERT INTO tree_nodes (id, card_id, parent_node_id, position, is_symlink, created_at) VALUES (?, ?, ?, ?, 0, ?)"
    ).run(orphan, cardId, "40000000-0000-4000-8000-000000000007", "0000000002", "2026-05-24T00:09:00.000Z");
  } finally {
    source.close();
  }

  const result = await migrate();

  expect(result).toMatchObject({ ok: false, statusCode: 400 });
  if (!result.ok) {
    expect(result.error).toContain("1");
    expect(result.error).toContain(orphan);
  }
  expect((await getIntegrationTestPool().query("SELECT id FROM tree_nodes")).rows).toEqual([]);
  expect(fs.existsSync(sqlitePath)).toBe(true);
  expect(fs.existsSync(sqlitePath + ".deprecated")).toBe(false);
});

it("copies every node from a source with multiple roots", async () => {
  const secondRoot = "40000000-0000-4000-8000-000000000008";
  const child = "40000000-0000-4000-8000-000000000009";
  const source = new Database(sqlitePath);
  try {
    source.prepare(
      "INSERT INTO tree_nodes (id, card_id, parent_node_id, position, is_symlink, created_at) VALUES (?, ?, NULL, ?, 0, ?)"
    ).run(secondRoot, cardId, "0000000002", "2026-05-24T00:09:00.000Z");
    source.prepare(
      "INSERT INTO tree_nodes (id, card_id, parent_node_id, position, is_symlink, created_at) VALUES (?, ?, ?, ?, 0, ?)"
    ).run(child, cardId, secondRoot, "0000000001", "2026-05-24T00:10:00.000Z");
  } finally {
    source.close();
  }

  expect(await migrate()).toEqual({ ok: true });
  expect((await getIntegrationTestPool().query("SELECT id, parent_node_id FROM tree_nodes ORDER BY id")).rows).toEqual([
    { id: nodeId, parent_node_id: null },
    { id: secondRoot, parent_node_id: null },
    { id: child, parent_node_id: secondRoot },
  ]);
});

it("preserves null, zero, and positive journal limits including on aliases", async () => {
  const zeroNode = "40000000-0000-4000-8000-000000000010";
  const aliasNode = "40000000-0000-4000-8000-000000000011";
  const positiveNode = "40000000-0000-4000-8000-000000000012";
  const source = new Database(sqlitePath);
  try {
    const insert = source.prepare(
      "INSERT INTO tree_nodes (id, card_id, parent_node_id, position, is_symlink, created_at, journal_limit) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    insert.run(zeroNode, cardId, nodeId, "0000000001", 0, "2026-05-24T00:09:00.000Z", 0);
    insert.run(aliasNode, cardId, nodeId, "0000000002", 1, "2026-05-24T00:10:00.000Z", 7);
    insert.run(positiveNode, cardId, nodeId, "0000000003", 0, "2026-05-24T00:11:00.000Z", 7);
  } finally {
    source.close();
  }

  expect(await migrate()).toEqual({ ok: true });
  expect((await getIntegrationTestPool().query(
    "SELECT id, journal_limit, is_symlink FROM tree_nodes ORDER BY id"
  )).rows).toEqual([
    { id: nodeId, journal_limit: null, is_symlink: false },
    { id: zeroNode, journal_limit: 0, is_symlink: false },
    { id: aliasNode, journal_limit: 7, is_symlink: true },
    { id: positiveNode, journal_limit: 7, is_symlink: false },
  ]);
});

it("checkpoints a WAL-only commit and keeps it in the renamed backup", async () => {
  const latestCard = "30000000-0000-4000-8000-000000000002";
  const snapshotPath = path.join(temp, "main-file-only.db");
  const writer = new Database(sqlitePath);
  let walExisted = false;
  let shmExisted = false;
  try {
    writer.pragma("journal_mode = WAL");
    writer.prepare("INSERT INTO cards (id, card_type, title) VALUES (?, 'knowledge', 'WAL latest card')").run(latestCard);
    walExisted = fs.existsSync(sqlitePath + "-wal");
    shmExisted = fs.existsSync(sqlitePath + "-shm");
    expect(fs.statSync(sqlitePath + "-wal").size).toBeGreaterThan(0);
    fs.copyFileSync(sqlitePath, snapshotPath);
    const mainOnly = new Database(snapshotPath, { readonly: true });
    try {
      expect(mainOnly.prepare("SELECT id FROM cards WHERE id = ?").get(latestCard)).toBeUndefined();
    } finally {
      mainOnly.close();
    }

    expect(await migrate()).toEqual({ ok: true });
    expect(fs.existsSync(sqlitePath)).toBe(false);
    expect(fs.existsSync(sqlitePath + ".deprecated")).toBe(true);
    expect(fs.existsSync(sqlitePath + "-wal")).toBe(false);
    expect(fs.existsSync(sqlitePath + "-shm")).toBe(false);
    if (walExisted) expect(fs.existsSync(sqlitePath + ".deprecated-wal")).toBe(true);
    if (shmExisted) expect(fs.existsSync(sqlitePath + ".deprecated-shm")).toBe(true);
  } finally {
    writer.close();
  }

  const backup = new Database(sqlitePath + ".deprecated", { readonly: true });
  try {
    expect(backup.prepare("SELECT id FROM cards WHERE id = ?").get(latestCard)).toEqual({ id: latestCard });
    for (const table of ["users", "agents", "cards", "tree_nodes"]) {
      const expected = backup.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number };
      const copied = await getIntegrationTestPool().query(`SELECT count(*) AS count FROM ${table}`);
      expect(Number(copied.rows[0]["count"])).toBe(expected.count);
    }
  } finally {
    backup.close();
  }
});

it("returns 409 and leaves both databases unchanged while another SQLite writer holds the file", async () => {
  const pg = getIntegrationTestPool();
  const writer = new Database(sqlitePath);
  writer.pragma("journal_mode = WAL");
  writer.exec("BEGIN IMMEDIATE");
  try {
    const result = await migrate();
    expect(result).toMatchObject({ ok: false, statusCode: 409 });
    if (!result.ok) expect(result.error).toContain("in use");
    expect((await pg.query("SELECT id FROM users")).rows).toEqual([{ id: seedUser }]);
    expect((await pg.query("SELECT id FROM agents")).rows).toEqual([]);
    expect((await pg.query("SELECT id FROM cards")).rows).toEqual([]);
    expect((await pg.query("SELECT id FROM tree_nodes")).rows).toEqual([]);
    expect(fs.existsSync(sqlitePath)).toBe(true);
    expect(fs.existsSync(sqlitePath + ".deprecated")).toBe(false);
  } finally {
    writer.exec("ROLLBACK");
    writer.close();
  }
});

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
