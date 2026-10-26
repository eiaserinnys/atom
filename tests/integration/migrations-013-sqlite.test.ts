import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import { closeDb, getDb, runMigrations, setDb } from "../../src/db/client.js";
import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations-sqlite");
const DROP_MIGRATION = path.join(MIGRATIONS_DIR, "013_drop_unused_card_fields.sql");
let migrationsBeforeDropDir: string;
let dropMigrationDir: string;

beforeEach(async () => {
  migrationsBeforeDropDir = fs.mkdtempSync(path.join(os.tmpdir(), "atom-migrations-013-"));
  dropMigrationDir = fs.mkdtempSync(path.join(os.tmpdir(), "atom-migrations-013-drop-"));
  fs.copyFileSync(DROP_MIGRATION, path.join(dropMigrationDir, path.basename(DROP_MIGRATION)));
  for (const file of fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql") && name !== path.basename(DROP_MIGRATION))) {
    fs.copyFileSync(path.join(MIGRATIONS_DIR, file), path.join(migrationsBeforeDropDir, file));
  }
  setDb(new SqliteAdapter(":memory:"));
  await runMigrations(migrationsBeforeDropDir);
});

afterEach(async () => {
  await closeDb();
  fs.rmSync(migrationsBeforeDropDir, { recursive: true, force: true });
  fs.rmSync(dropMigrationDir, { recursive: true, force: true });
});

describe("migration 013 on SQLite", () => {
  it("removes retired fields and keeps cards, snapshots, and tree nodes", async () => {
    const retired = ["stale" + "ness", "source_" + "checksum", "source_" + "checked_at"];
    await getDb().query(
      `INSERT INTO cards (id, card_type, title, source_snapshot, ${retired[1]}, ${retired[2]}, ${retired[0]})
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ["card-1", "knowledge", "Existing card", "snapshot payload", "checksum", "2026-01-01", "fresh"]
    );
    await getDb().query(
      `INSERT INTO tree_nodes (id, card_id, parent_node_id, position)
       VALUES ($1, $2, $3, $4)`,
      ["node-1", "card-1", null, "0000000100"]
    );

    await runMigrations(dropMigrationDir);

    const names = (await getDb().query(`SELECT name FROM pragma_table_info('cards')`)).rows
      .map((row) => row["name"] as string);
    expect(names).not.toEqual(expect.arrayContaining(retired));
    expect(names).toContain("source_snapshot");
    expect(names).toContain("created_by");

    const cards = await getDb().query(`SELECT id, title, source_snapshot FROM cards WHERE id = $1`, ["card-1"]);
    expect(cards.rows).toEqual([{ id: "card-1", title: "Existing card", source_snapshot: "snapshot payload" }]);
    const indexed = await getDb().query(
      `SELECT rowid FROM cards_fts WHERE cards_fts MATCH $1`,
      ["Existing"]
    );
    expect(indexed.rows).toHaveLength(1);
    const nodes = await getDb().query(`SELECT id, card_id FROM tree_nodes WHERE id = $1`, ["node-1"]);
    expect(nodes.rows).toEqual([{ id: "node-1", card_id: "card-1" }]);
  });
});
