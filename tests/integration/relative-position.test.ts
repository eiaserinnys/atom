/**
 * Integration tests for cycle B relative position API.
 *
 * Tests: before/after/to, child_orders, parent-keep semantics,
 * deprecated-position warning, mutual exclusivity, rekey-on-adjacent.
 *
 * Requires TEST_DATABASE_URL pointing to a test PostgreSQL instance.
 */

import path from "path";
import { fileURLToPath } from "url";
import { setPool, closePool, runMigrations } from "../../src/db/client.js";
import { PostgresAdapter } from "../../src/db/adapters/postgres.js";
import { executeBatchOp } from "../../src/services/batch.service.js";
import * as cardService from "../../src/services/card.service.js";
import * as treeService from "../../src/services/tree.service.js";
import { selectChildren } from "../../src/db/queries/tree.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations");

let pool: PostgresAdapter;

beforeAll(async () => {
  const databaseUrl = process.env["TEST_DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error(
      "TEST_DATABASE_URL is required.\n" +
        "Set it to: postgresql://atom:atom@localhost:5434/atom_test_db"
    );
  }
  if (!databaseUrl.includes("test")) {
    throw new Error("TEST_DATABASE_URL must contain 'test'. Got: " + databaseUrl);
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

// Helpers
async function createParentWithChildren(
  childCount: number,
  spacing = 100
): Promise<{ parentNodeId: string; childNodeIds: string[] }> {
  const creates = [
    { temp_id: "parent", card_type: "structure" as const, title: "Parent" },
    ...Array.from({ length: childCount }, (_, i) => ({
      temp_id: `c${i}`,
      card_type: "knowledge" as const,
      title: `Child ${i}`,
      parent_temp_id: "parent",
      position: (i + 1) * spacing,
    })),
  ];
  const result = await executeBatchOp({ creates });
  const parentNodeId = result.created.find((c) => c.temp_id === "parent")!.node_id;
  const childNodeIds = Array.from({ length: childCount }, (_, i) =>
    result.created.find((c) => c.temp_id === `c${i}`)!.node_id
  );
  return { parentNodeId, childNodeIds };
}

// ---------------------------------------------------------------------------
// move_node — before/after/to
// ---------------------------------------------------------------------------

describe("move_node — relative positioning", () => {
  it("before: places node before a sibling", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(3);
    const [a, b, c] = childNodeIds;

    // Move C before A
    const { node: moved } = await treeService.moveNode(c, {
      parent_node_id: parentNodeId,
      before: a,
    });
    expect(moved).not.toBeNull();

    const children = await selectChildren(pool, parentNodeId);
    expect(children.map((n) => n.id)).toEqual([c, a, b]);
  });

  it("after: places node after a sibling", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(3);
    const [a, b, c] = childNodeIds;

    // Move A after B
    const { node: moved } = await treeService.moveNode(a, {
      parent_node_id: parentNodeId,
      after: b,
    });
    expect(moved).not.toBeNull();

    const children = await selectChildren(pool, parentNodeId);
    expect(children.map((n) => n.id)).toEqual([b, a, c]);
  });

  it("to='start': places node as first child", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(3);
    const [a, b, c] = childNodeIds;

    const { node: moved } = await treeService.moveNode(c, {
      parent_node_id: parentNodeId,
      to: "start",
    });
    expect(moved).not.toBeNull();

    const children = await selectChildren(pool, parentNodeId);
    expect(children.map((n) => n.id)).toEqual([c, a, b]);
  });

  it("to='end': places node as last child", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(3);
    const [a, b, c] = childNodeIds;

    const { node: moved } = await treeService.moveNode(a, {
      parent_node_id: parentNodeId,
      to: "end",
    });
    expect(moved).not.toBeNull();

    const children = await selectChildren(pool, parentNodeId);
    expect(children.map((n) => n.id)).toEqual([b, c, a]);
  });

  it("before first child with position 0: triggers rekey", async () => {
    // Create child at position 0
    const parentResult = await executeBatchOp({
      creates: [
        { temp_id: "p", card_type: "structure", title: "Parent" },
        {
          temp_id: "first",
          card_type: "knowledge",
          title: "First",
          parent_temp_id: "p",
          position: 0,
        },
      ],
    });
    const parentNodeId = parentResult.created.find((c) => c.temp_id === "p")!.node_id;
    const firstNodeId = parentResult.created.find((c) => c.temp_id === "first")!.node_id;

    // Create a node to move before "first"
    const { node_id: moverNodeId } = await cardService.createCard({
      card_type: "knowledge",
      title: "Mover",
      parent_node_id: parentNodeId,
    });

    // to="start" should trigger rekey since first child is at 0
    const { node: moved } = await treeService.moveNode(moverNodeId, {
      parent_node_id: parentNodeId,
      to: "start",
    });
    expect(moved).not.toBeNull();

    const children = await selectChildren(pool, parentNodeId);
    // Mover should be first
    expect(children[0].id).toBe(moverNodeId);
    // All positions should be valid numbers (no fractional keys)
    for (const child of children) {
      expect(Number.isInteger(child.position)).toBe(true);
      expect(child.position).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// move_node — parent semantics (f995e015 fix)
// ---------------------------------------------------------------------------

describe("move_node — parent keep-current (f995e015 fix)", () => {
  it("omit parent_node_id: keeps current parent (not root)", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(3);
    const [a, b, c] = childNodeIds;

    // Move A to end WITHOUT specifying parent — should stay under same parent
    const { node: moved } = await treeService.moveNode(a, { to: "end" });
    expect(moved).not.toBeNull();
    expect(moved!.parent_node_id).toBe(parentNodeId); // NOT null/root

    const children = await selectChildren(pool, parentNodeId);
    expect(children.map((n) => n.id)).toEqual([b, c, a]);
  });

  it("f995e015 scenario 1: batch_op moves position-only reorder keeps parent", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(2);
    const [a, b] = childNodeIds;

    // Move A with new_position only, no new_parent_node_id — should keep parent
    await executeBatchOp({
      moves: [{ node_id: a, new_position: 300 }],
    });

    const children = await selectChildren(pool, parentNodeId);
    expect(children.some((n) => n.id === a)).toBe(true);
    // A should NOT be at root
    const aNode = children.find((n) => n.id === a)!;
    expect(aNode.parent_node_id).toBe(parentNodeId);
  });

  it("f995e015 scenario 2: batch_op moves 23 nodes position-only keeps parent", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(5);

    // Move all 5 with position-only (no parent specified)
    await executeBatchOp({
      moves: childNodeIds.map((nodeId, i) => ({
        node_id: nodeId,
        new_position: (5 - i) * 100, // reverse order
      })),
    });

    const children = await selectChildren(pool, parentNodeId);
    expect(children).toHaveLength(5);
    // All should still be under parent, not root
    for (const child of children) {
      expect(child.parent_node_id).toBe(parentNodeId);
    }
    // Order should be reversed
    expect(children.map((n) => n.id)).toEqual([...childNodeIds].reverse());
  });

  it("parent_node_id = null: explicitly moves to root", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(1);
    const [a] = childNodeIds;

    const { node: moved } = await treeService.moveNode(a, {
      parent_node_id: null,
    });
    expect(moved).not.toBeNull();
    expect(moved!.parent_node_id).toBeNull();

    // Not under parent anymore
    const children = await selectChildren(pool, parentNodeId);
    expect(children).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// move_node — deprecated position + warnings
// ---------------------------------------------------------------------------

describe("move_node — deprecated position", () => {
  it("position works but returns _warnings", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(2);
    const [a] = childNodeIds;

    const { node: moved, warnings } = await treeService.moveNode(a, {
      parent_node_id: parentNodeId,
      position: 50,
    });
    expect(moved).not.toBeNull();
    expect(moved!.position).toBe(50);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("deprecated");
  });
});

// ---------------------------------------------------------------------------
// move_node — mutual exclusivity
// ---------------------------------------------------------------------------

describe("move_node — mutual exclusivity", () => {
  it("before + after: throws", async () => {
    const { childNodeIds } = await createParentWithChildren(2);
    const [a, b] = childNodeIds;

    await expect(
      treeService.moveNode(a, { before: b, after: b })
    ).rejects.toThrow(/only one of/);
  });

  it("before + position: throws", async () => {
    const { childNodeIds } = await createParentWithChildren(2);
    const [a, b] = childNodeIds;

    await expect(
      treeService.moveNode(a, { before: b, position: 100 })
    ).rejects.toThrow(/only one of/);
  });

  it("to + after: throws", async () => {
    const { childNodeIds } = await createParentWithChildren(2);
    const [a, b] = childNodeIds;

    await expect(
      treeService.moveNode(a, { to: "start", after: b })
    ).rejects.toThrow(/only one of/);
  });
});

// ---------------------------------------------------------------------------
// move_node — before/after non-existent sibling
// ---------------------------------------------------------------------------

describe("move_node — error cases", () => {
  it("before non-existent sibling: throws", async () => {
    const { childNodeIds } = await createParentWithChildren(1);
    const [a] = childNodeIds;

    await expect(
      treeService.moveNode(a, { before: "00000000-0000-0000-0000-000000000000" })
    ).rejects.toThrow(/not found among siblings/);
  });
});

// ---------------------------------------------------------------------------
// batch_op — child_orders
// ---------------------------------------------------------------------------

describe("batch_op — child_orders", () => {
  it("reorders children", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(4);
    const [a, b, c, d] = childNodeIds;

    // Reverse order: d, c, b, a
    await executeBatchOp({
      child_orders: [
        { parent_node_id: parentNodeId, order: [d, c, b, a] },
      ],
    });

    const children = await selectChildren(pool, parentNodeId);
    expect(children.map((n) => n.id)).toEqual([d, c, b, a]);
  });

  it("cross-parent: re-parents nodes listed in order", async () => {
    const { parentNodeId: p1, childNodeIds: [a, b] } =
      await createParentWithChildren(2);
    const { parentNodeId: p2, childNodeIds: [c] } =
      await createParentWithChildren(1);

    // Move C from p2 to p1 via child_orders
    await executeBatchOp({
      child_orders: [
        { parent_node_id: p1, order: [a, c, b] },
      ],
    });

    const childrenP1 = await selectChildren(pool, p1);
    expect(childrenP1.map((n) => n.id)).toEqual([a, c, b]);

    // C should no longer be under p2
    const childrenP2 = await selectChildren(pool, p2);
    expect(childrenP2.some((n) => n.id === c)).toBe(false);
  });

  it("child_orders after moves: both applied in sequence", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(3);
    const [a, b, c] = childNodeIds;

    // Move A to end, then reorder all
    await executeBatchOp({
      moves: [{ node_id: a, new_parent_node_id: parentNodeId, to: "end" }],
      child_orders: [
        { parent_node_id: parentNodeId, order: [c, b, a] },
      ],
    });

    const children = await selectChildren(pool, parentNodeId);
    expect(children.map((n) => n.id)).toEqual([c, b, a]);
  });

  it("child_orders with non-existent node: throws and rolls back", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(1);

    await expect(
      executeBatchOp({
        child_orders: [
          {
            parent_node_id: parentNodeId,
            order: ["00000000-0000-0000-0000-000000000000"],
          },
        ],
      })
    ).rejects.toThrow(/node not found/);
  });

  it("result includes child_ordered parent IDs", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(2);

    const result = await executeBatchOp({
      child_orders: [
        { parent_node_id: parentNodeId, order: [...childNodeIds].reverse() },
      ],
    });

    expect(result.child_ordered).toEqual([parentNodeId]);
  });
});

// ---------------------------------------------------------------------------
// batch_op — moves with relative positioning
// ---------------------------------------------------------------------------

describe("batch_op — moves with before/after/to", () => {
  it("batch move with before", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(3);
    const [a, b, c] = childNodeIds;

    // Move C before A
    await executeBatchOp({
      moves: [
        { node_id: c, new_parent_node_id: parentNodeId, before: a },
      ],
    });

    const children = await selectChildren(pool, parentNodeId);
    expect(children.map((n) => n.id)).toEqual([c, a, b]);
  });

  it("batch move with to='start'", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(3);
    const [a, b, c] = childNodeIds;

    await executeBatchOp({
      moves: [
        { node_id: c, new_parent_node_id: parentNodeId, to: "start" },
      ],
    });

    const children = await selectChildren(pool, parentNodeId);
    expect(children[0].id).toBe(c);
  });
});

// ---------------------------------------------------------------------------
// Rekey on adjacent positions
// ---------------------------------------------------------------------------

describe("rekey on adjacent positions", () => {
  it("inserts between adjacent siblings by rekeying", async () => {
    // Create two children with adjacent positions (100, 101)
    const parentResult = await executeBatchOp({
      creates: [
        { temp_id: "p", card_type: "structure", title: "Parent" },
        {
          temp_id: "a",
          card_type: "knowledge",
          title: "A",
          parent_temp_id: "p",
          position: 100,
        },
        {
          temp_id: "b",
          card_type: "knowledge",
          title: "B",
          parent_temp_id: "p",
          position: 101,
        },
      ],
    });
    const parentNodeId = parentResult.created.find((c) => c.temp_id === "p")!.node_id;
    const aNodeId = parentResult.created.find((c) => c.temp_id === "a")!.node_id;
    const bNodeId = parentResult.created.find((c) => c.temp_id === "b")!.node_id;

    // Create a new node and move it between A and B
    const { node_id: moverNodeId } = await cardService.createCard({
      card_type: "knowledge",
      title: "Mover",
    });

    const { node: moved } = await treeService.moveNode(moverNodeId, {
      parent_node_id: parentNodeId,
      before: bNodeId,
    });
    expect(moved).not.toBeNull();

    const children = await selectChildren(pool, parentNodeId);
    // Order should be A, Mover, B
    expect(children.map((n) => n.id)).toEqual([aNodeId, moverNodeId, bNodeId]);
    // All positions should be valid integers (rekey happened)
    for (const child of children) {
      expect(Number.isInteger(child.position)).toBe(true);
    }
  });
});
