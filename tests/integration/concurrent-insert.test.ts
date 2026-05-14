/**
 * Concurrent insert / move integration tests — incident 3a1b7800 closure.
 *
 * After migration 010 removed the (parent, position) UNIQUE constraint, two
 * transactions inserting children at the same parent never collide via
 * 23505. The (parent, position, id) tie-break gives a deterministic
 * ordering when two siblings share a key.
 *
 * These tests use PostgresAdapter.transaction() in parallel via
 * Promise.all, which delegates to pool.connect() under the hood — each
 * transaction holds an independent pg.PoolClient so the PG server processes
 * them concurrently (single-process setTimeout interleaving would not
 * reproduce true server-level race semantics).
 *
 * Requires TEST_DATABASE_URL.
 */

import path from "path";
import { fileURLToPath } from "url";
import { setPool, closePool, runMigrations } from "../../src/db/client.js";
import { PostgresAdapter } from "../../src/db/adapters/postgres.js";
import { insertNode, selectChildren } from "../../src/db/queries/tree.js";
import { insertCard } from "../../src/db/queries/cards.js";

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

describe("concurrent-insert — incident 3a1b7800 closure", () => {
  it("C1: two parallel inserts to the same parent both succeed (no UNIQUE)", async () => {
    const parent = await insertCard(pool, { card_type: "structure", title: "P" });
    const parentNode = await insertNode(pool, parent.id, null, undefined);

    const cardA = await insertCard(pool, { card_type: "knowledge", title: "A" });
    const cardB = await insertCard(pool, { card_type: "knowledge", title: "B" });

    // Two independent transactions, run concurrently. Each transaction holds
    // its own pg.PoolClient via PostgresAdapter.transaction → pool.connect().
    const [nodeA, nodeB] = await Promise.all([
      pool.transaction(async (tx) =>
        insertNode(tx, cardA.id, parentNode.id, undefined)
      ),
      pool.transaction(async (tx) =>
        insertNode(tx, cardB.id, parentNode.id, undefined)
      ),
    ]);

    // Both succeed
    expect(nodeA).toBeDefined();
    expect(nodeB).toBeDefined();
    // And both end up under the parent
    const children = await selectChildren(pool, parentNode.id);
    expect(children).toHaveLength(2);
    expect(new Set(children.map((c) => c.id))).toEqual(
      new Set([nodeA.id, nodeB.id])
    );
  });

  it("C2: same-position siblings get deterministic order by (position, id)", async () => {
    const parent = await insertCard(pool, { card_type: "structure", title: "P" });
    const parentNode = await insertNode(pool, parent.id, null, undefined);

    const cardA = await insertCard(pool, { card_type: "knowledge", title: "A" });
    const cardB = await insertCard(pool, { card_type: "knowledge", title: "B" });

    // Force both at the same explicit position
    const [nodeA, nodeB] = await Promise.all([
      pool.transaction(async (tx) =>
        insertNode(tx, cardA.id, parentNode.id, 500)
      ),
      pool.transaction(async (tx) =>
        insertNode(tx, cardB.id, parentNode.id, 500)
      ),
    ]);

    expect(nodeA.position).toBe(500);
    expect(nodeB.position).toBe(500);

    const children = await selectChildren(pool, parentNode.id);
    expect(children).toHaveLength(2);
    expect(children[0].position).toBe(500);
    expect(children[1].position).toBe(500);

    // Order is deterministic: smaller id first (id ASC tie-break)
    const expectedIds = [nodeA.id, nodeB.id].sort();
    expect(children.map((c) => c.id)).toEqual(expectedIds);
  });

  it("C3: same explicit position from two parallel transactions both succeed", async () => {
    const parent = await insertCard(pool, { card_type: "structure", title: "P" });
    const parentNode = await insertNode(pool, parent.id, null, undefined);

    const cardA = await insertCard(pool, { card_type: "knowledge", title: "A" });
    const cardB = await insertCard(pool, { card_type: "knowledge", title: "B" });

    await expect(
      Promise.all([
        pool.transaction(async (tx) =>
          insertNode(tx, cardA.id, parentNode.id, 700)
        ),
        pool.transaction(async (tx) =>
          insertNode(tx, cardB.id, parentNode.id, 700)
        ),
      ])
    ).resolves.toBeDefined();

    const children = await selectChildren(pool, parentNode.id);
    const positions = children.map((c) => c.position);
    expect(positions).toEqual([700, 700]);
  });

  it("C4: pre-existing siblings with identical (parent, position) survive without violating any constraint", async () => {
    // After migration 010, the legacy duplicate scenario that triggered
    // incident 3a1b7800 (uidx_tree_nodes_child_pos failure) is impossible
    // because the UNIQUE index no longer exists. Verify by manually
    // inserting two rows with the same parent+position.
    const parent = await insertCard(pool, { card_type: "structure", title: "P" });
    const parentNode = await insertNode(pool, parent.id, null, undefined);

    const cardA = await insertCard(pool, { card_type: "knowledge", title: "A" });
    const cardB = await insertCard(pool, { card_type: "knowledge", title: "B" });

    // Direct INSERT bypassing insertNode's resolution path
    await pool.query(
      `INSERT INTO tree_nodes (id, card_id, parent_node_id, position, is_symlink)
       VALUES ($1, $2, $3, $4, $5)`,
      [crypto.randomUUID(), cardA.id, parentNode.id, "0000000900", false]
    );
    await pool.query(
      `INSERT INTO tree_nodes (id, card_id, parent_node_id, position, is_symlink)
       VALUES ($1, $2, $3, $4, $5)`,
      [crypto.randomUUID(), cardB.id, parentNode.id, "0000000900", false]
    );

    const children = await selectChildren(pool, parentNode.id);
    expect(children).toHaveLength(2);
    expect(children.every((c) => c.position === 900)).toBe(true);
  });
});
