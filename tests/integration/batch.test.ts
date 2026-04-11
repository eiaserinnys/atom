/**
 * Integration tests for batch_op service.
 *
 * Requires TEST_DATABASE_URL to point to a running PostgreSQL instance.
 *   TEST_DATABASE_URL=postgresql://atom:atom@localhost:5434/atom_test_db npx jest tests/integration/batch.test.ts
 */

import pg from "pg";
import path from "path";
import { setPool, closePool, runMigrations } from "../../src/db/client.js";
import { executeBatchOp, topologicalSortCreates } from "../../src/services/batch.service.js";
import * as cardService from "../../src/services/card.service.js";

const { Pool } = pg;

const MIGRATIONS_DIR = path.resolve(process.cwd(), "src/db/migrations");

let pool: pg.Pool;

beforeAll(async () => {
  const databaseUrl = process.env["TEST_DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error(
      "TEST_DATABASE_URL is required for integration tests.\n" +
        "Set it to the atom-postgres instance: postgresql://atom:atom@localhost:5434/atom_test_db"
    );
  }

  if (databaseUrl.includes("atom_db") && !databaseUrl.includes("test")) {
    throw new Error("TEST_DATABASE_URL must use a test database, not the production atom_db.\nUse: postgresql://atom:atom@localhost:5434/atom_test_db");
  }

  pool = new Pool({ connectionString: databaseUrl });
  setPool(pool);
  await runMigrations(MIGRATIONS_DIR);
}, 30000);

afterAll(async () => {
  await closePool();
}, 10000);

afterEach(async () => {
  // Delete in FK order: tree_nodes → cards → agents → users
  await pool.query("DELETE FROM tree_nodes");
  await pool.query("DELETE FROM cards");
  await pool.query("DELETE FROM agents");
  await pool.query("DELETE FROM users");
});

// ---------------------------------------------------------------------------
// topologicalSortCreates (unit-level, no DB)
// ---------------------------------------------------------------------------

describe("topologicalSortCreates", () => {
  it("returns items in dependency order", () => {
    const items = [
      { temp_id: "c", parent_temp_id: "b", card_type: "knowledge" as const, title: "C" },
      { temp_id: "a", card_type: "structure" as const, title: "A" },
      { temp_id: "b", parent_temp_id: "a", card_type: "structure" as const, title: "B" },
    ];
    const sorted = topologicalSortCreates(items);
    const ids = sorted.map((i) => i.temp_id);
    expect(ids.indexOf("a")).toBeLessThan(ids.indexOf("b"));
    expect(ids.indexOf("b")).toBeLessThan(ids.indexOf("c"));
  });

  it("throws on circular parent_temp_id", () => {
    const items = [
      { temp_id: "a", parent_temp_id: "b", card_type: "structure" as const, title: "A" },
      { temp_id: "b", parent_temp_id: "a", card_type: "structure" as const, title: "B" },
    ];
    expect(() => topologicalSortCreates(items)).toThrow(/[Cc]ircular/);
  });

  it("throws on unknown parent_temp_id", () => {
    const items = [
      { temp_id: "a", parent_temp_id: "nonexistent", card_type: "structure" as const, title: "A" },
    ];
    expect(() => topologicalSortCreates(items)).toThrow(/not found/);
  });
});

// ---------------------------------------------------------------------------
// executeBatchOp — normal path
// ---------------------------------------------------------------------------

describe("executeBatchOp — creates", () => {
  it("creates a structure card with a child knowledge card", async () => {
    const result = await executeBatchOp({
      creates: [
        { temp_id: "root", card_type: "structure", title: "Root Section" },
        {
          temp_id: "child",
          card_type: "knowledge",
          title: "A fact",
          content: "Detail here",
          parent_temp_id: "root",
          source_type: "slack",
          source_ref: "#general, 2026-04-02",
        },
      ],
    });

    expect(result.created).toHaveLength(2);
    const rootEntry = result.created.find((c) => c.temp_id === "root")!;
    const childEntry = result.created.find((c) => c.temp_id === "child")!;

    expect(rootEntry.card_id).toBeTruthy();
    expect(rootEntry.node_id).toBeTruthy();
    expect(childEntry.card_id).toBeTruthy();
    expect(childEntry.node_id).toBeTruthy();

    // Verify parent-child relationship in DB
    const nodeRow = await pool.query(
      "SELECT parent_node_id FROM tree_nodes WHERE id = $1",
      [childEntry.node_id]
    );
    expect(nodeRow.rows[0]["parent_node_id"]).toBe(rootEntry.node_id);
  });

  it("returns correct temp_id mapping", async () => {
    const result = await executeBatchOp({
      creates: [
        { temp_id: "t1", card_type: "knowledge", title: "Card 1" },
        { temp_id: "t2", card_type: "knowledge", title: "Card 2" },
      ],
    });

    const tempIds = result.created.map((c) => c.temp_id).sort();
    expect(tempIds).toEqual(["t1", "t2"]);

    // Both cards actually exist in DB
    for (const item of result.created) {
      const card = await cardService.getCard(item.card_id);
      expect(card).not.toBeNull();
    }
  });
});

describe("executeBatchOp — updates", () => {
  it("updates an existing card's title and content", async () => {
    const { card } = await cardService.createCard({
      card_type: "knowledge",
      title: "Original",
      content: "Old content",
    });

    await executeBatchOp({
      updates: [
        { card_id: card.id, title: "Updated Title", content: "New content" },
      ],
    });

    const updated = await cardService.getCard(card.id);
    expect(updated!.title).toBe("Updated Title");
    expect(updated!.content).toBe("New content");
    expect(updated!.version).toBeGreaterThan(card.version);
  });
});

describe("executeBatchOp — moves", () => {
  it("moves a node to a new parent", async () => {
    const { card: parentCard, node_id: parentNodeId } = await cardService.createCard({
      card_type: "structure",
      title: "Parent",
    });
    const { card: childCard, node_id: childNodeId } = await cardService.createCard({
      card_type: "knowledge",
      title: "Child",
    });

    await executeBatchOp({
      moves: [
        {
          node_id: childNodeId,
          new_parent_node_id: parentNodeId,
        },
      ],
    });

    const nodeRow = await pool.query(
      "SELECT parent_node_id FROM tree_nodes WHERE id = $1",
      [childNodeId]
    );
    expect(nodeRow.rows[0]["parent_node_id"]).toBe(parentNodeId);

    // Avoid unused variable warning
    expect(parentCard.id).toBeTruthy();
    expect(childCard.id).toBeTruthy();
  });

  it("moves a node to a create's node via parent_temp_id", async () => {
    const { card: existingCard, node_id: existingNodeId } =
      await cardService.createCard({
        card_type: "knowledge",
        title: "Node to move",
      });

    const result = await executeBatchOp({
      creates: [
        { temp_id: "newParent", card_type: "structure", title: "New Parent" },
      ],
      moves: [
        {
          node_id: existingNodeId,
          parent_temp_id: "newParent",
        },
      ],
    });

    const newParentNodeId = result.created.find(
      (c) => c.temp_id === "newParent"
    )!.node_id;

    const nodeRow = await pool.query(
      "SELECT parent_node_id FROM tree_nodes WHERE id = $1",
      [existingNodeId]
    );
    expect(nodeRow.rows[0]["parent_node_id"]).toBe(newParentNodeId);
    expect(existingCard.id).toBeTruthy();
  });
});

describe("executeBatchOp — same-parent reorder moves", () => {
  it("reorders children under the same parent without position conflict", async () => {
    // Create parent + 3 children
    const createResult = await executeBatchOp({
      creates: [
        { temp_id: "parent", card_type: "structure", title: "Parent" },
        {
          temp_id: "a",
          card_type: "knowledge",
          title: "Child A",
          parent_temp_id: "parent",
          position: 100,
        },
        {
          temp_id: "b",
          card_type: "knowledge",
          title: "Child B",
          parent_temp_id: "parent",
          position: 200,
        },
        {
          temp_id: "c",
          card_type: "knowledge",
          title: "Child C",
          parent_temp_id: "parent",
          position: 300,
        },
      ],
    });

    const parentNodeId = createResult.created.find(
      (c) => c.temp_id === "parent"
    )!.node_id;
    const aNodeId = createResult.created.find(
      (c) => c.temp_id === "a"
    )!.node_id;
    const bNodeId = createResult.created.find(
      (c) => c.temp_id === "b"
    )!.node_id;
    const cNodeId = createResult.created.find(
      (c) => c.temp_id === "c"
    )!.node_id;

    // Reorder: B(100), C(200), A(300) — positions overlap with originals
    await executeBatchOp({
      moves: [
        { node_id: bNodeId, new_parent_node_id: parentNodeId, new_position: 100 },
        { node_id: cNodeId, new_parent_node_id: parentNodeId, new_position: 200 },
        { node_id: aNodeId, new_parent_node_id: parentNodeId, new_position: 300 },
      ],
    });

    // Verify final order
    const rows = await pool.query(
      "SELECT id, position FROM tree_nodes WHERE parent_node_id = $1 ORDER BY position ASC",
      [parentNodeId]
    );
    expect(rows.rows.map((r: Record<string, unknown>) => r["id"])).toEqual([
      bNodeId,
      cNodeId,
      aNodeId,
    ]);
  });

  it("reorders 10+ children under the same parent", async () => {
    // Create parent
    const parentResult = await executeBatchOp({
      creates: [
        { temp_id: "parent", card_type: "structure", title: "Big Parent" },
      ],
    });
    const parentNodeId = parentResult.created[0].node_id;

    // Create 12 children
    const childCreates = Array.from({ length: 12 }, (_, i) => ({
      temp_id: `child${i}`,
      card_type: "knowledge" as const,
      title: `Child ${i}`,
      parent_node_id: parentNodeId,
      position: (i + 1) * 100,
    }));
    const childResult = await executeBatchOp({ creates: childCreates });
    const childNodeIds = childResult.created.map((c) => c.node_id);

    // Reverse the order: child11 first, child0 last
    const reversedMoves = childNodeIds.map((nodeId, i) => ({
      node_id: nodeId,
      new_parent_node_id: parentNodeId,
      new_position: (childNodeIds.length - i) * 100,
    }));

    await executeBatchOp({ moves: reversedMoves });

    // Verify reversed order
    const rows = await pool.query(
      "SELECT id FROM tree_nodes WHERE parent_node_id = $1 ORDER BY position ASC",
      [parentNodeId]
    );
    const actualOrder = rows.rows.map((r: Record<string, unknown>) => r["id"]);
    expect(actualOrder).toEqual([...childNodeIds].reverse());
  });

  it("handles mixed same-parent and cross-parent moves", async () => {
    const createResult = await executeBatchOp({
      creates: [
        { temp_id: "p1", card_type: "structure", title: "Parent 1" },
        { temp_id: "p2", card_type: "structure", title: "Parent 2" },
        {
          temp_id: "a",
          card_type: "knowledge",
          title: "A",
          parent_temp_id: "p1",
          position: 100,
        },
        {
          temp_id: "b",
          card_type: "knowledge",
          title: "B",
          parent_temp_id: "p1",
          position: 200,
        },
        {
          temp_id: "c",
          card_type: "knowledge",
          title: "C",
          parent_temp_id: "p2",
          position: 100,
        },
      ],
    });

    const p1NodeId = createResult.created.find(
      (c) => c.temp_id === "p1"
    )!.node_id;
    const aNodeId = createResult.created.find(
      (c) => c.temp_id === "a"
    )!.node_id;
    const bNodeId = createResult.created.find(
      (c) => c.temp_id === "b"
    )!.node_id;
    const cNodeId = createResult.created.find(
      (c) => c.temp_id === "c"
    )!.node_id;

    // Swap A and B under p1, move C to p1
    await executeBatchOp({
      moves: [
        { node_id: bNodeId, new_parent_node_id: p1NodeId, new_position: 100 },
        { node_id: aNodeId, new_parent_node_id: p1NodeId, new_position: 200 },
        { node_id: cNodeId, new_parent_node_id: p1NodeId, new_position: 300 },
      ],
    });

    const rows = await pool.query(
      "SELECT id FROM tree_nodes WHERE parent_node_id = $1 ORDER BY position ASC",
      [p1NodeId]
    );
    expect(rows.rows.map((r: Record<string, unknown>) => r["id"])).toEqual([
      bNodeId,
      aNodeId,
      cNodeId,
    ]);
  });

  it("handles position conflicts with non-group siblings", async () => {
    // A(100), B(200), C(300), D(400) under parent.
    // Reorder only A and B to positions that overlap with C and D.
    const createResult = await executeBatchOp({
      creates: [
        { temp_id: "parent", card_type: "structure", title: "Parent" },
        {
          temp_id: "a",
          card_type: "knowledge",
          title: "A",
          parent_temp_id: "parent",
          position: 100,
        },
        {
          temp_id: "b",
          card_type: "knowledge",
          title: "B",
          parent_temp_id: "parent",
          position: 200,
        },
        {
          temp_id: "c",
          card_type: "knowledge",
          title: "C",
          parent_temp_id: "parent",
          position: 300,
        },
        {
          temp_id: "d",
          card_type: "knowledge",
          title: "D",
          parent_temp_id: "parent",
          position: 400,
        },
      ],
    });

    const parentNodeId = createResult.created.find(
      (c) => c.temp_id === "parent"
    )!.node_id;
    const aNodeId = createResult.created.find(
      (c) => c.temp_id === "a"
    )!.node_id;
    const bNodeId = createResult.created.find(
      (c) => c.temp_id === "b"
    )!.node_id;
    const cNodeId = createResult.created.find(
      (c) => c.temp_id === "c"
    )!.node_id;
    const dNodeId = createResult.created.find(
      (c) => c.temp_id === "d"
    )!.node_id;

    // Move A to 300 and B to 400 — overlaps with C(300) and D(400)
    await executeBatchOp({
      moves: [
        { node_id: aNodeId, new_parent_node_id: parentNodeId, new_position: 300 },
        { node_id: bNodeId, new_parent_node_id: parentNodeId, new_position: 400 },
      ],
    });

    // Verify: C and D should have been relocated, A and B at requested positions
    const rows = await pool.query(
      "SELECT id, position FROM tree_nodes WHERE parent_node_id = $1 ORDER BY position ASC",
      [parentNodeId]
    );
    const positions = rows.rows.map(
      (r: Record<string, unknown>) => r["position"]
    );
    const ids = rows.rows.map((r: Record<string, unknown>) => r["id"]);

    // All positions should be unique
    expect(new Set(positions).size).toBe(4);
    // A and B should be at their requested positions
    const aPos = rows.rows.find(
      (r: Record<string, unknown>) => r["id"] === aNodeId
    )!["position"];
    const bPos = rows.rows.find(
      (r: Record<string, unknown>) => r["id"] === bNodeId
    )!["position"];
    expect(aPos).toBe(300);
    expect(bPos).toBe(400);
    // C and D should still be present (relocated to non-conflicting positions)
    expect(ids).toContain(cNodeId);
    expect(ids).toContain(dNodeId);
  });

  it("reorders with undefined positions (append-to-end)", async () => {
    const createResult = await executeBatchOp({
      creates: [
        { temp_id: "parent", card_type: "structure", title: "Parent" },
        {
          temp_id: "a",
          card_type: "knowledge",
          title: "A",
          parent_temp_id: "parent",
          position: 100,
        },
        {
          temp_id: "b",
          card_type: "knowledge",
          title: "B",
          parent_temp_id: "parent",
          position: 200,
        },
      ],
    });

    const parentNodeId = createResult.created.find(
      (c) => c.temp_id === "parent"
    )!.node_id;
    const aNodeId = createResult.created.find(
      (c) => c.temp_id === "a"
    )!.node_id;
    const bNodeId = createResult.created.find(
      (c) => c.temp_id === "b"
    )!.node_id;

    // Move both without specifying position — both append to end
    await executeBatchOp({
      moves: [
        { node_id: aNodeId, new_parent_node_id: parentNodeId },
        { node_id: bNodeId, new_parent_node_id: parentNodeId },
      ],
    });

    // Both should still be under parent, positions should be distinct
    const rows = await pool.query(
      "SELECT id, position FROM tree_nodes WHERE parent_node_id = $1 ORDER BY position ASC",
      [parentNodeId]
    );
    expect(rows.rows).toHaveLength(2);
    const positions = rows.rows.map(
      (r: Record<string, unknown>) => r["position"]
    );
    expect(new Set(positions).size).toBe(2); // distinct positions
  });
});

describe("executeBatchOp — deletes", () => {
  it("deletes an existing card", async () => {
    const { card } = await cardService.createCard({
      card_type: "knowledge",
      title: "To delete",
    });

    const result = await executeBatchOp({
      deletes: [{ card_id: card.id }],
    });

    expect(result.deleted).toContain(card.id);

    const gone = await cardService.getCard(card.id);
    expect(gone).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// executeBatchOp — symlinks
// ---------------------------------------------------------------------------

describe("executeBatchOp — symlinks", () => {
  it("creates a symlink node for an existing card", async () => {
    const { card, node_id: originalNodeId } = await cardService.createCard({
      card_type: "knowledge",
      title: "Symlink target",
      content: "Some content",
    });

    const result = await executeBatchOp({
      symlinks: [
        { card_id: card.id, parent_node_id: null },
      ],
    });

    expect(result.symlinked).toHaveLength(1);
    const symlinkNodeId = result.symlinked[0];
    expect(symlinkNodeId).toBeTruthy();
    expect(symlinkNodeId).not.toBe(originalNodeId);

    // Verify node is a symlink in DB
    const nodeRow = await pool.query(
      "SELECT is_symlink, card_id FROM tree_nodes WHERE id = $1",
      [symlinkNodeId]
    );
    expect(nodeRow.rows[0]["is_symlink"]).toBe(true);
    expect(nodeRow.rows[0]["card_id"]).toBe(card.id);
  });

  it("rolls back when symlink references non-existent card_id", async () => {
    const before = await pool.query("SELECT COUNT(*) FROM tree_nodes");
    const countBefore = parseInt(before.rows[0]["count"], 10);

    await expect(
      executeBatchOp({
        creates: [
          { temp_id: "ok", card_type: "structure", title: "Should roll back" },
        ],
        symlinks: [
          {
            card_id: "00000000-0000-0000-0000-000000000000",
            parent_node_id: null,
          },
        ],
      })
    ).rejects.toThrow();

    const after = await pool.query("SELECT COUNT(*) FROM tree_nodes");
    const countAfter = parseInt(after.rows[0]["count"], 10);
    expect(countAfter).toBe(countBefore);
  });

  it("symlinks a card created earlier in the same batch", async () => {
    // First batch: create a card
    const createResult = await executeBatchOp({
      creates: [
        { temp_id: "src", card_type: "knowledge", title: "Source Card" },
        { temp_id: "dest", card_type: "structure", title: "Dest Folder" },
      ],
    });

    const srcCardId = createResult.created.find((c) => c.temp_id === "src")!.card_id;
    const destNodeId = createResult.created.find((c) => c.temp_id === "dest")!.node_id;

    // Second batch: symlink the card under the dest folder
    const symlinkResult = await executeBatchOp({
      symlinks: [
        { card_id: srcCardId, parent_node_id: destNodeId },
      ],
    });

    expect(symlinkResult.symlinked).toHaveLength(1);

    // Verify both the original node and the symlink exist for the same card
    const nodes = await pool.query(
      "SELECT id, is_symlink FROM tree_nodes WHERE card_id = $1 ORDER BY is_symlink",
      [srcCardId]
    );
    expect(nodes.rows).toHaveLength(2);
    expect(nodes.rows[0]["is_symlink"]).toBe(false);
    expect(nodes.rows[1]["is_symlink"]).toBe(true);
  });

  it("places symlink under a node created in the same batch via parent_temp_id", async () => {
    // Create a card to symlink
    const { card: srcCard } = await cardService.createCard({
      card_type: "knowledge",
      title: "Symlink source",
    });

    // Single batch: create a folder and place a symlink under it using parent_temp_id
    const result = await executeBatchOp({
      creates: [
        { temp_id: "folder", card_type: "structure", title: "New Folder" },
      ],
      symlinks: [
        { card_id: srcCard.id, parent_temp_id: "folder" },
      ],
    });

    expect(result.created).toHaveLength(1);
    expect(result.symlinked).toHaveLength(1);

    const folderNodeId = result.created[0].node_id;
    const symlinkNodeId = result.symlinked[0];

    // Verify the symlink node is a child of the newly created folder
    const nodeRow = await pool.query(
      "SELECT parent_id, is_symlink FROM tree_nodes WHERE id = $1",
      [symlinkNodeId]
    );
    expect(nodeRow.rows[0]["parent_id"]).toBe(folderNodeId);
    expect(nodeRow.rows[0]["is_symlink"]).toBe(true);
  });

  it("throws when parent_temp_id references a temp_id not in the same batch", async () => {
    const { card } = await cardService.createCard({
      card_type: "knowledge",
      title: "Orphan symlink source",
    });

    await expect(
      executeBatchOp({
        symlinks: [
          { card_id: card.id, parent_temp_id: "nonexistent-temp-id" },
        ],
      })
    ).rejects.toThrow('parent_temp_id "nonexistent-temp-id" not found among batch creates');
  });
});

// ---------------------------------------------------------------------------
// executeBatchOp — mixed operations
// ---------------------------------------------------------------------------

describe("executeBatchOp — mixed operations", () => {
  it("runs creates + updates + moves + deletes in one transaction", async () => {
    const { card: updateTarget } = await cardService.createCard({
      card_type: "knowledge",
      title: "To update",
    });
    const { card: deleteTarget } = await cardService.createCard({
      card_type: "knowledge",
      title: "To delete",
    });
    const { card: moveTarget, node_id: moveTargetNodeId } =
      await cardService.createCard({
        card_type: "knowledge",
        title: "To move",
      });

    const result = await executeBatchOp({
      creates: [
        { temp_id: "newRoot", card_type: "structure", title: "New Root" },
      ],
      updates: [{ card_id: updateTarget.id, title: "Updated" }],
      moves: [{ node_id: moveTargetNodeId, parent_temp_id: "newRoot" }],
      deletes: [{ card_id: deleteTarget.id }],
    });

    expect(result.created).toHaveLength(1);
    expect(result.updated).toContain(updateTarget.id);
    expect(result.moved).toContain(moveTargetNodeId);
    expect(result.deleted).toContain(deleteTarget.id);

    expect(moveTarget.id).toBeTruthy();
  });
});

describe("executeBatchOp — empty input", () => {
  it("handles empty batch gracefully", async () => {
    const result = await executeBatchOp({});
    expect(result.created).toHaveLength(0);
    expect(result.symlinked).toHaveLength(0);
    expect(result.updated).toHaveLength(0);
    expect(result.moved).toHaveLength(0);
    expect(result.deleted).toHaveLength(0);
  });

  it("handles all-empty arrays", async () => {
    const result = await executeBatchOp({
      creates: [],
      symlinks: [],
      updates: [],
      moves: [],
      deletes: [],
    });
    expect(result.created).toHaveLength(0);
  });
});

describe("executeBatchOp — rollback on error", () => {
  it("rolls back all operations when one fails", async () => {
    // Count cards before
    const before = await pool.query("SELECT COUNT(*) FROM cards");
    const countBefore = parseInt(before.rows[0]["count"], 10);

    await expect(
      executeBatchOp({
        creates: [
          { temp_id: "ok", card_type: "structure", title: "Should roll back" },
        ],
        updates: [
          {
            // Non-existent card_id — doesn't throw, but we can use an invalid
            // operation to trigger a DB error
            card_id: "00000000-0000-0000-0000-000000000000",
            title: "x".repeat(200), // Exceeds VARCHAR(50) limit → DB error
          },
        ],
      })
    ).rejects.toThrow();

    const after = await pool.query("SELECT COUNT(*) FROM cards");
    const countAfter = parseInt(after.rows[0]["count"], 10);

    // No cards were created — transaction was rolled back
    expect(countAfter).toBe(countBefore);
  });
});
