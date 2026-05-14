/**
 * Migration 010 (LexoRank position) integration tests.
 *
 * Validates the post-migration state of tree_nodes after migration 010 has
 * been applied. PostgreSQL has no schema_migrations tracking in atom, so
 * 010 is re-executed on every server start — `information_schema` and
 * `pg_indexes` queries confirm the column type, default, and index layout.
 *
 * Requires TEST_DATABASE_URL.
 */

import path from "path";
import { fileURLToPath } from "url";
import { setPool, closePool, runMigrations, getDb } from "../../src/db/client.js";
import { PostgresAdapter } from "../../src/db/adapters/postgres.js";
import { insertNode } from "../../src/db/queries/tree.js";
import { insertCard } from "../../src/db/queries/cards.js";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations");

let pool: PostgresAdapter;

beforeAll(async () => {
  const databaseUrl = process.env["TEST_DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error(
      "TEST_DATABASE_URL is required. Set it to the atom-postgres test instance."
    );
  }
  if (!databaseUrl.includes("test")) {
    throw new Error(`TEST_DATABASE_URL must contain 'test'. Got: ${databaseUrl}`);
  }
  pool = new PostgresAdapter(databaseUrl);
  setPool(pool);
  await runMigrations(MIGRATIONS_DIR);
}, 30000);

afterAll(async () => {
  await closePool();
}, 10000);

afterEach(async () => {
  await pool.query("DELETE FROM tree_nodes");
  await pool.query("DELETE FROM cards");
});

// ---------------------------------------------------------------------------
// M1: column type and default
// ---------------------------------------------------------------------------

describe("migration 010 — column type", () => {
  it("M1: tree_nodes.position is TEXT with default '0000000000'", async () => {
    const result = await pool.query(
      `SELECT data_type, column_default
       FROM information_schema.columns
       WHERE table_name = 'tree_nodes' AND column_name = 'position'`,
      []
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]["data_type"]).toBe("text");
    // PostgreSQL stores defaults as expressions; the literal '0000000000'::text
    expect(String(result.rows[0]["column_default"])).toContain("0000000000");
  });
});

// ---------------------------------------------------------------------------
// M2: data preservation — inserts keep sort order across number boundary
// ---------------------------------------------------------------------------

describe("migration 010 — data integrity after migration", () => {
  it("M2: empty parent → first insertNode defaults to position=100 (COALESCE boundary)", async () => {
    const parent = await insertCard(pool, { card_type: "structure", title: "P" });
    const child = await insertCard(pool, { card_type: "knowledge", title: "C" });

    // Default position (undefined) on an empty parent must produce 100, not 0
    // or any park-territory value. This is the COALESCE('0000000000') edge case.
    const node = await insertNode(pool, child.id, null, undefined);
    // root parent (null) — same key space
    const firstChild = await insertNode(pool, child.id, node.id, undefined);
    expect(firstChild.position).toBe(100);
  });

  it("M2: positions across insertNode calls match integer sort order", async () => {
    const parent = await insertCard(pool, { card_type: "structure", title: "P" });
    const parentNode = await insertNode(pool, parent.id, null, undefined);

    const c1 = await insertCard(pool, { card_type: "knowledge", title: "C1" });
    const c2 = await insertCard(pool, { card_type: "knowledge", title: "C2" });
    const c3 = await insertCard(pool, { card_type: "knowledge", title: "C3" });

    // Explicit positions out of order — DB should sort them
    await insertNode(pool, c1.id, parentNode.id, 300);
    await insertNode(pool, c2.id, parentNode.id, 100);
    await insertNode(pool, c3.id, parentNode.id, 200);

    const sorted = await pool.query(
      `SELECT card_id, position FROM tree_nodes
       WHERE parent_node_id = $1
       ORDER BY position ASC, id ASC`,
      [parentNode.id]
    );
    expect(sorted.rows.map((r: Record<string, unknown>) => r["card_id"])).toEqual([
      c2.id,
      c3.id,
      c1.id,
    ]);
    // Stored as zero-padded strings
    expect(sorted.rows[0]["position"]).toBe("0000000100");
    expect(sorted.rows[1]["position"]).toBe("0000000200");
    expect(sorted.rows[2]["position"]).toBe("0000000300");
  });
});

// ---------------------------------------------------------------------------
// M3: idempotency — re-running 010 is a no-op
// ---------------------------------------------------------------------------

describe("migration 010 — idempotency", () => {
  it("M3: re-applying migration 010 SQL is a no-op (information_schema guard)", async () => {
    const sql = fs.readFileSync(
      path.join(MIGRATIONS_DIR, "010_lexorank_position.sql"),
      "utf-8"
    );
    // First re-run is implicit via beforeAll's runMigrations.
    // Run once more — must not throw, must not alter the schema.
    await pool.query(sql);
    await pool.query(sql);

    const result = await pool.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name = 'tree_nodes' AND column_name = 'position'`,
      []
    );
    expect(result.rows[0]["data_type"]).toBe("text");
  });
});

// ---------------------------------------------------------------------------
// M4: UNIQUE indexes removed
// ---------------------------------------------------------------------------

describe("migration 010 — UNIQUE constraint removed", () => {
  it("M4: uidx_tree_nodes_root_pos and uidx_tree_nodes_child_pos are gone", async () => {
    const result = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'tree_nodes'
         AND indexname IN ('uidx_tree_nodes_root_pos', 'uidx_tree_nodes_child_pos')`,
      []
    );
    expect(result.rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// M5: BTREE index (parent, position, id) exists
// ---------------------------------------------------------------------------

describe("migration 010 — tie-break index", () => {
  it("M5: idx_tree_nodes_parent_pos_id exists", async () => {
    const result = await pool.query(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE tablename = 'tree_nodes' AND indexname = 'idx_tree_nodes_parent_pos_id'`,
      []
    );
    expect(result.rows).toHaveLength(1);
    const indexdef = String(result.rows[0]["indexdef"]);
    expect(indexdef).toContain("parent_node_id");
    expect(indexdef).toContain("position");
    expect(indexdef).toContain("id");
    // Non-unique
    expect(indexdef.toLowerCase()).not.toContain("unique");
  });
});
