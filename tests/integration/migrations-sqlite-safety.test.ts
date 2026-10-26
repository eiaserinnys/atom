import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";

const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/db/migrations-sqlite");
const migration013 = "013_drop_unused_card_fields.sql";
let temp: string;
let dbPath: string;
let pending: string;
let adapter: SqliteAdapter | undefined;

beforeEach(async () => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "atom-migration-safety-"));
  dbPath = path.join(temp, "test.db");
  pending = path.join(temp, "pending");
  const prior = path.join(temp, "prior");
  fs.mkdirSync(prior);
  fs.mkdirSync(pending);
  for (const file of fs.readdirSync(migrations).filter(file => file.endsWith(".sql") && file < migration013)) {
    fs.copyFileSync(path.join(migrations, file), path.join(prior, file));
  }
  adapter = new SqliteAdapter(dbPath);
  await adapter.runMigrations(prior);
  await adapter.query("INSERT INTO cards (id, card_type, title) VALUES ('card-1', 'knowledge', 'Preserved card')");
  await adapter.query("INSERT INTO tree_nodes (id, card_id, position) VALUES ('node-1', 'card-1', '0000000001')");
});

afterEach(async () => {
  await adapter?.close();
  fs.rmSync(temp, { recursive: true, force: true });
});

async function restart() {
  await adapter!.close();
  adapter = new SqliteAdapter(dbPath);
}

async function expectPreserved() {
  expect((await adapter!.query("SELECT id, title FROM cards")).rows)
    .toEqual([{ id: "card-1", title: "Preserved card" }]);
  expect((await adapter!.query("SELECT id, card_id FROM tree_nodes")).rows)
    .toEqual([{ id: "node-1", card_id: "card-1" }]);
  expect((await adapter!.query("SELECT * FROM pragma_foreign_key_check")).rows).toEqual([]);
  expect((await adapter!.query("SELECT * FROM pragma_foreign_keys")).rows).toEqual([{ foreign_keys: 1 }]);
}

it("rolls back a failure between DROP and RENAME, then applies successfully on restart", async () => {
  const sql = fs.readFileSync(path.join(migrations, migration013), "utf8");
  fs.writeFileSync(path.join(pending, migration013), sql.replace("ALTER TABLE cards_new", "SELECT * FROM injected_failure;\nALTER TABLE cards_new"));
  await expect(adapter!.runMigrations(pending)).rejects.toMatchObject({ message: expect.stringContaining("injected_failure") });
  await restart();
  await expectPreserved();
  expect((await adapter!.query("SELECT name FROM schema_migrations WHERE name = $1", [migration013])).rows).toEqual([]);
  fs.writeFileSync(path.join(pending, migration013), sql);
  await adapter!.runMigrations(pending);
  await expectPreserved();
  expect((await adapter!.query("SELECT rowid FROM cards_fts WHERE cards_fts MATCH 'Preserved'")).rows).toHaveLength(1);
});

it("restores the sole cards_new copy left by an interrupted legacy 013", async () => {
  await adapter!.close();
  adapter = undefined;
  const raw = new Database(dbPath);
  const sql = fs.readFileSync(path.join(migrations, migration013), "utf8");
  try {
    raw.pragma("foreign_keys = OFF");
    raw.exec(sql.split("ALTER TABLE cards_new RENAME TO cards;")[0]);
    expect(raw.prepare("SELECT count(*) AS count FROM cards_new").get()).toEqual({ count: 1 });
  } finally {
    raw.close();
  }
  adapter = new SqliteAdapter(dbPath);
  await adapter.runMigrations(migrations);
  await expectPreserved();
});

it("rolls back SQL changes if recording completion fails", async () => {
  fs.writeFileSync(path.join(pending, "999_record.sql"), "CREATE TABLE should_rollback (id TEXT);");
  await adapter!.close();
  adapter = undefined;
  const raw = new Database(dbPath);
  raw.exec("CREATE TRIGGER fail_record BEFORE INSERT ON schema_migrations BEGIN SELECT RAISE(ABORT, 'record failure'); END");
  raw.close();
  adapter = new SqliteAdapter(dbPath);
  await expect(adapter.runMigrations(pending)).rejects.toMatchObject({ message: "record failure" });
  expect((await adapter.query("SELECT name FROM sqlite_master WHERE name = 'should_rollback'")).rows).toEqual([]);
});

it("rejects foreign key violations before commit and restores the caller's pragma", async () => {
  fs.writeFileSync(path.join(pending, "999_invalid.sql"), "DELETE FROM cards;");
  await expect(adapter!.runMigrations(pending)).rejects.toThrow();
  await expectPreserved();
});
