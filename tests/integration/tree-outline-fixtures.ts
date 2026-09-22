/**
 * Shared tree fixture for the GET /api/tree/outline contract.
 * Adapter-agnostic: seeds through the services, so both the Postgres and the
 * SQLite suites build the same tree.
 *
 *   R (structure)            X (structure, root)
 *   ├── A (structure)        ├── X1
 *   │   ├── A1               └── X2
 *   │   │   └── A1a
 *   │   │       └── A1ai     ← depth 4 below R: counted, never expanded
 *   │   └── A2
 *   ├── B
 *   └── ~S  (symlink → card of X)
 *
 * Every card carries a `BODY-<name>` content so tests can prove bodies never
 * leak into the outline.
 *
 * Seeds with plain INSERTs rather than cardService.createCard / insertNode:
 * on SQLite the write path is broken on main (insertCard reuses `$10`, which
 * the positional `?` translation cannot bind; insertNode binds a JS boolean
 * for is_symlink, which better-sqlite3 rejects). Pre-existing and unrelated
 * to the read-only outline query.
 */
import { getDb } from "../../src/db/client.js";
import { serializeArray } from "../../src/db/utils.js";
import { posToKey } from "../../src/shared/lexorank.js";
import type { TreeOutline, TreeOutlineNode } from "../../src/shared/types.js";

// Insertion order = sibling order (keys grow monotonically across the fixture).
let nextPosition = 100;

async function seedNode(cardId: string, parent: string | null, isSymlink: boolean): Promise<string> {
  const db = getDb();
  const id = crypto.randomUUID();
  const position = posToKey(nextPosition);
  nextPosition += 100;
  await db.query(
    `INSERT INTO tree_nodes (id, card_id, parent_node_id, position, is_symlink)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, cardId, parent, position, db.dbType === "sqlite" ? Number(isSymlink) : isSymlink]
  );
  return id;
}

export interface OutlineFixture {
  R: string;
  A: string;
  A1: string;
  A1a: string;
  A1ai: string;
  A2: string;
  B: string;
  S: string;
  X: string;
  X1: string;
  X2: string;
}

export async function seedCard(
  title: string,
  parent: string | null,
  card_type: "structure" | "knowledge" = "knowledge"
): Promise<{ nodeId: string; cardId: string }> {
  const db = getDb();
  const cardId = crypto.randomUUID();
  await db.query(
    `INSERT INTO cards (id, card_type, title, content, tags, "references")
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [cardId, card_type, title, `BODY-${title}`, serializeArray([]), serializeArray([])]
  );
  return { nodeId: await seedNode(cardId, parent, false), cardId };
}


export async function seedOutlineFixture(): Promise<OutlineFixture> {
  const R = (await seedCard("R", null, "structure")).nodeId;
  const X = await seedCard("X", null, "structure");
  const X1 = (await seedCard("X1", X.nodeId)).nodeId;
  const X2 = (await seedCard("X2", X.nodeId)).nodeId;

  const A = (await seedCard("A", R, "structure")).nodeId;
  const A1 = (await seedCard("A1", A)).nodeId;
  const A1a = (await seedCard("A1a", A1)).nodeId;
  const A1ai = (await seedCard("A1ai", A1a)).nodeId;
  const A2 = (await seedCard("A2", A)).nodeId;
  const B = (await seedCard("B", R)).nodeId;
  const S = await seedNode(X.cardId, R, true);

  return { R, A, A1, A1a, A1ai, A2, B, S, X: X.nodeId, X1, X2 };
}

export interface OutlineShape {
  title: string;
  child_count: number;
  descendant_count: number;
  is_symlink: boolean;
  children: OutlineShape[];
}

/** Project an outline onto the fields a structural assertion cares about. */
export function shapeOf(nodes: TreeOutlineNode[]): OutlineShape[] {
  return nodes.map((n) => ({
    title: n.title,
    child_count: n.child_count,
    descendant_count: n.descendant_count,
    is_symlink: n.is_symlink,
    children: shapeOf(n.children),
  }));
}

function leaf(title: string, child_count: number, descendant_count: number, is_symlink = false): OutlineShape {
  return { title, child_count, descendant_count, is_symlink, children: [] };
}

/** Expected shape of R's outline at each allowed depth. */
export function expectedUnderR(depth: 1 | 2 | 3): OutlineShape[] {
  const a1 =
    depth >= 3
      ? { ...leaf("A1", 1, 2), children: [leaf("A1a", 1, 1)] }
      : leaf("A1", 1, 2);
  const a =
    depth >= 2
      ? { ...leaf("A", 2, 4), children: [a1, leaf("A2", 0, 0)] }
      : leaf("A", 2, 4);
  return [a, leaf("B", 0, 0), leaf("X", 0, 0, true)];
}

/** Recursively assert that no outline node carries a card body. */
export function expectNoBodies(outline: TreeOutline): void {
  const serialized = JSON.stringify(outline);
  expect(serialized).not.toContain("BODY-");
  const walk = (nodes: TreeOutlineNode[]): void => {
    for (const n of nodes) {
      expect(Object.keys(n).sort()).toEqual([
        "card_id",
        "card_type",
        "child_count",
        "children",
        "descendant_count",
        "id",
        "is_symlink",
        "parent_node_id",
        "position",
        "title",
      ]);
      walk(n.children);
    }
  };
  walk(outline.nodes);
}
