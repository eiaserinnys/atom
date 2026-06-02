import type { Queryable } from "../db/queryable.js";
import {
  keyBetween,
  NORMAL_DIGIT_COUNT,
  posToKey,
  rekeyEvenly,
} from "../shared/lexorank.js";

export interface MoveNodeOptions {
  /** Destination parent. undefined = keep current, null = root. */
  parent_node_id?: string | null;
  /** @deprecated Use before/after/to. Absolute position (still works). */
  position?: number;
  /** Place before this sibling node_id. */
  before?: string;
  /** Place after this sibling node_id. */
  after?: string;
  /** Place at start or end of parent's children. */
  to?: "start" | "end";
}

interface PositionSpecifierOptions {
  before?: string;
  after?: string;
  to?: "start" | "end";
  position?: number;
}

interface ResolvedPositionKey {
  key: string;
  warnings: string[];
}

interface PositionSibling {
  id: string;
  key: string;
}

const DEPRECATED_POSITION_WARNING =
  "position is deprecated; use before, after, or to instead";

/**
 * Resolve a relative or absolute position specifier into a normal-territory
 * LexoRank key string. If keyBetween would produce a fractional key, this
 * module rekeys siblings under the parent first so public `position: number`
 * responses continue to work.
 */
export async function resolvePositionKey(
  db: Queryable,
  parentNodeId: string | null,
  selfNodeId: string | null,
  opts: PositionSpecifierOptions
): Promise<ResolvedPositionKey> {
  validateSinglePositionSpecifier(opts);

  if (opts.position !== undefined) {
    return resolveDeprecatedAbsolutePosition(opts.position);
  }

  if (hasRelativePositionSpecifier(opts)) {
    return resolveRelativePositionKey(db, parentNodeId, selfNodeId, opts);
  }

  return resolveAppendPositionKey(db, parentNodeId, selfNodeId);
}

function validateSinglePositionSpecifier(opts: PositionSpecifierOptions): void {
  const specifiers = [opts.before, opts.after, opts.to, opts.position].filter(
    (v) => v !== undefined
  );
  if (specifiers.length > 1) {
    throw new Error(
      "move_node: only one of before, after, to, or position may be specified"
    );
  }
}

function resolveDeprecatedAbsolutePosition(position: number): ResolvedPositionKey {
  if (position < 0) {
    throw new Error(`move_node: position must be non-negative, got ${position}`);
  }
  return {
    key: posToKey(position),
    warnings: [DEPRECATED_POSITION_WARNING],
  };
}

function hasRelativePositionSpecifier(opts: PositionSpecifierOptions): boolean {
  return Boolean(opts.before || opts.after || opts.to);
}

async function resolveRelativePositionKey(
  db: Queryable,
  parentNodeId: string | null,
  selfNodeId: string | null,
  opts: PositionSpecifierOptions
): Promise<ResolvedPositionKey> {
  const allSiblings = await selectPositionSiblings(db, parentNodeId);
  validateRelativeTargets(allSiblings, opts);

  const siblings = selfNodeId
    ? allSiblings.filter((s) => s.id !== selfNodeId)
    : allSiblings;

  const insertionIndex = resolveInsertionIndex(allSiblings, siblings, selfNodeId, opts);
  if (insertionIndex.type === "self") {
    return { key: insertionIndex.key, warnings: [] };
  }

  // Destination has no siblings after excluding self: assign the default key.
  if (siblings.length === 0) {
    return { key: posToKey(100), warnings: [] };
  }

  const key = await keyForInsertion(db, parentNodeId, siblings, insertionIndex.index);
  return { key, warnings: [] };
}

function validateRelativeTargets(
  allSiblings: PositionSibling[],
  opts: PositionSpecifierOptions
): void {
  // Validate before/after target BEFORE self-exclusion; otherwise a
  // non-existent sibling can be masked by the empty-array shortcut.
  if (opts.before) {
    if (!allSiblings.some((s) => s.id === opts.before)) {
      throw new Error(
        `move_node: before node '${opts.before}' not found among siblings of parent`
      );
    }
  }
  if (opts.after) {
    if (!allSiblings.some((s) => s.id === opts.after)) {
      throw new Error(
        `move_node: after node '${opts.after}' not found among siblings of parent`
      );
    }
  }
}

type InsertionIndex =
  | { type: "index"; index: number }
  | { type: "self"; key: string };

function resolveInsertionIndex(
  allSiblings: PositionSibling[],
  siblings: PositionSibling[],
  selfNodeId: string | null,
  opts: PositionSpecifierOptions
): InsertionIndex {
  if (opts.before) {
    const insertionIndex = siblings.findIndex((s) => s.id === opts.before);
    if (insertionIndex < 0) {
      const selfIdx = allSiblings.findIndex((s) => s.id === selfNodeId);
      return { type: "self", key: allSiblings[selfIdx].key };
    }
    return { type: "index", index: insertionIndex };
  }

  if (opts.after) {
    const afterIdx = siblings.findIndex((s) => s.id === opts.after);
    if (afterIdx < 0) {
      const selfIdx = allSiblings.findIndex((s) => s.id === selfNodeId);
      return { type: "self", key: allSiblings[selfIdx].key };
    }
    return { type: "index", index: afterIdx + 1 };
  }

  if (opts.to === "start") {
    return { type: "index", index: 0 };
  }

  return { type: "index", index: siblings.length };
}

async function keyForInsertion(
  db: Queryable,
  parentNodeId: string | null,
  siblings: PositionSibling[],
  insertionIndex: number
): Promise<string> {
  const prevKey =
    insertionIndex > 0
      ? siblings[insertionIndex - 1].key
      : null;
  const nextKey =
    insertionIndex < siblings.length
      ? siblings[insertionIndex].key
      : null;

  try {
    const key = keyBetween(prevKey, nextKey);
    if (key.length <= NORMAL_DIGIT_COUNT) {
      return key;
    }
  } catch {
    // Adjacent keys or zero-boundary: rekey all siblings to make room.
  }

  return rekeyAndInsert(db, parentNodeId, siblings, insertionIndex);
}

async function resolveAppendPositionKey(
  db: Queryable,
  parentNodeId: string | null,
  selfNodeId: string | null
): Promise<ResolvedPositionKey> {
  const siblings = await selectPositionSiblings(db, parentNodeId, selfNodeId);
  if (siblings.length === 0) {
    return { key: posToKey(100), warnings: [] };
  }

  try {
    const key = keyBetween(siblings[siblings.length - 1].key, null);
    if (key.length <= NORMAL_DIGIT_COUNT) {
      return { key, warnings: [] };
    }
  } catch {
    // Non-normal leaked keys are repaired by rekeying the whole sibling set.
  }

  return {
    key: await rekeyAndInsert(db, parentNodeId, siblings, siblings.length),
    warnings: [],
  };
}

async function rekeyAndInsert(
  db: Queryable,
  parentNodeId: string | null,
  currentSiblings: PositionSibling[],
  insertionIndex: number
): Promise<string> {
  const totalCount = currentSiblings.length + 1;
  const keys = rekeyEvenly(totalCount);

  let keyIdx = 0;
  for (let i = 0; i < currentSiblings.length; i++) {
    if (keyIdx === insertionIndex) keyIdx++;
    await db.query(
      `UPDATE tree_nodes SET position = $1 WHERE id = $2`,
      [keys[keyIdx], currentSiblings[i].id]
    );
    keyIdx++;
  }

  return keys[insertionIndex];
}

async function selectPositionSiblings(
  db: Queryable,
  parentNodeId: string | null,
  excludeNodeId?: string | null
): Promise<PositionSibling[]> {
  const result = await db.query(
    `SELECT id, position FROM tree_nodes
     WHERE parent_node_id IS NOT DISTINCT FROM $1${excludeNodeId ? " AND id != $2" : ""}
     ORDER BY position ASC, id ASC`,
    excludeNodeId ? [parentNodeId, excludeNodeId] : [parentNodeId]
  );
  return result.rows.map((row) => ({
    id: row["id"] as string,
    key: row["position"] as string,
  }));
}
