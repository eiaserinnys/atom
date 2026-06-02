import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { closeDb, getDb, runMigrations, setDb } from "../../src/db/client.js";
import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations-sqlite");
const MIGRATION_011 = path.resolve(
  MIGRATIONS_DIR,
  "011_rekey_overflow_positions.sql"
);

let dbPath: string;

beforeEach(async () => {
  dbPath = path.join(os.tmpdir(), `atom-migration-011-${crypto.randomUUID()}.db`);
  setDb(new SqliteAdapter(dbPath));
  await runMigrations(MIGRATIONS_DIR);
});

afterEach(async () => {
  await closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
});

async function seedOverflowSiblings(parentNodeId: string): Promise<void> {
  await getDb().query(
    `INSERT INTO cards (id, card_type, title, tags, "references")
     VALUES
       ($1, $2, $3, $4, $5),
       ($6, $7, $8, $9, $10),
       ($11, $12, $13, $14, $15),
       ($16, $17, $18, $19, $20)`,
    [
      "card-parent",
      "structure",
      "Parent",
      "[]",
      "[]",
      "card-a",
      "knowledge",
      "A",
      "[]",
      "[]",
      "card-b",
      "knowledge",
      "B",
      "[]",
      "[]",
      "card-c",
      "knowledge",
      "C",
      "[]",
      "[]",
    ]
  );
  await getDb().query(
    `INSERT INTO tree_nodes (id, card_id, parent_node_id, position, is_symlink)
     VALUES
       ($1, $2, $3, $4, $5),
       ($6, $7, $8, $9, $10),
       ($11, $12, $13, $14, $15),
       ($16, $17, $18, $19, $20)`,
    [
      parentNodeId,
      "card-parent",
      null,
      "0000000100",
      0,
      "node-a",
      "card-a",
      parentNodeId,
      "0000000100",
      0,
      "node-b",
      "card-b",
      parentNodeId,
      "2147483648",
      0,
      "node-c",
      "card-c",
      parentNodeId,
      "0000000300",
      0,
    ]
  );
}

async function rawPositions(parentNodeId: string): Promise<string[]> {
  const result = await getDb().query(
    `SELECT position FROM tree_nodes
     WHERE parent_node_id IS NOT DISTINCT FROM $1
     ORDER BY position ASC, id ASC`,
    [parentNodeId]
  );
  return result.rows.map((row) => row["position"] as string);
}

describe("migration 011 — overflow position cleanup", () => {
  it("rekeys leaked INT32 overflow positions and is idempotent", async () => {
    const parentNodeId = "parent-node";
    await seedOverflowSiblings(parentNodeId);

    const sql = fs.readFileSync(MIGRATION_011, "utf-8");
    await getDb().query(sql);
    const afterFirstRun = await rawPositions(parentNodeId);

    await getDb().query(sql);
    const afterSecondRun = await rawPositions(parentNodeId);

    expect(afterSecondRun).toEqual(afterFirstRun);
    expect(afterSecondRun).toEqual([
      "0000000100",
      "0000000200",
      "0000000300",
    ]);
  });
});
