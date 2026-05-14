import type { TreeNode } from "../../shared/types.js";
import type { Queryable } from "../queryable.js";
import { deserializeBoolean } from "../utils.js";
import { posToKey, keyToPos } from "../../shared/lexorank.js";

/**
 * Map a DB row to the public TreeNode shape.
 *
 * Cycle A1: `position` is stored as TEXT (zero-padded 10-digit key in normal
 * territory) but exposed externally as `number` for backward compatibility.
 * `keyToPos` performs the bijective conversion and defensively throws if a
 * park-territory key (transient batch.service state) leaks through — that
 * would indicate a transactional invariant violation upstream.
 */
function rowToNode(row: Record<string, unknown>): TreeNode {
  const rawPosition = row["position"];
  const position =
    typeof rawPosition === "string"
      ? keyToPos(rawPosition)
      // Defensive fallback: if some driver coerces TEXT to number, accept it
      // but still funnel through posToKey/keyToPos to validate range.
      : keyToPos(posToKey(rawPosition as number));
  return {
    id: row["id"] as string,
    card_id: row["card_id"] as string,
    parent_node_id: (row["parent_node_id"] as string | null) ?? null,
    position,
    is_symlink: deserializeBoolean(row["is_symlink"]),
    created_at: row["created_at"] as string,
    journal_limit: (row["journal_limit"] as number | null) ?? null,
  };
}

function isInTransaction(db: Queryable): boolean {
  return db.inTransaction === true;
}

export async function insertNode(
  db: Queryable,
  card_id: string,
  parent_node_id: string | null,
  position: number | undefined,
  is_symlink: boolean = false
): Promise<TreeNode> {
  const MAX_RETRIES = 3;
  const inTxn = isInTransaction(db);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let resolvedKey: string;
    if (position !== undefined) {
      resolvedKey = posToKey(position);
    } else {
      // Default: append at end. MAX(position) on the normal-territory subset
      // — the `position >= '0000000000'` filter excludes park keys ('!', '"')
      // that batch.service may have parked transiently. COALESCE handles the
      // empty-parent case (no siblings yet).
      const maxResult = await db.query(
        `SELECT COALESCE(MAX(position), '0000000000') AS max_pos
         FROM tree_nodes
         WHERE parent_node_id IS NOT DISTINCT FROM $1
           AND position >= '0000000000'`,
        [parent_node_id]
      );
      const maxNumeric = keyToPos(maxResult.rows[0]["max_pos"] as string);
      resolvedKey = posToKey(maxNumeric + 100);
    }

    const sp = `sp_insert_node_${attempt}`;
    if (inTxn) await db.query(`SAVEPOINT ${sp}`);

    const id = crypto.randomUUID();
    try {
      const result = await db.query(
        `INSERT INTO tree_nodes (id, card_id, parent_node_id, position, is_symlink)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [id, card_id, parent_node_id, resolvedKey, is_symlink]
      );
      if (inTxn) await db.query(`RELEASE SAVEPOINT ${sp}`);
      return rowToNode(result.rows[0]);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === "23505" || code === "SQLITE_CONSTRAINT_UNIQUE") {
        // Cycle A1: dead branch — the (parent, position) UNIQUE constraint was
        // removed in migration 010, so 23505 / SQLITE_CONSTRAINT_UNIQUE never
        // triggers for position collisions. Kept for defensive symmetry; cycle
        // A2 will remove the retry-loop entirely along with park-and-assign.
        if (inTxn) await db.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        await renumberSiblings(db, parent_node_id);
      } else {
        if (inTxn) await db.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        throw err;
      }
    }
  }
  throw new Error(
    `insertNode: position conflict persists after ${MAX_RETRIES} retries (parent_node_id=${parent_node_id})`
  );
}

async function renumberSiblings(
  db: Queryable,
  parent_node_id: string | null
): Promise<void> {
  // Cycle A1: this function is no longer reached at runtime — UNIQUE conflicts
  // can't occur. Kept for symmetry with cycle A2's removal pass.
  // Fetch all siblings ordered by current position, reassign '0000000100',
  // '0000000200', '0000000300'…
  const siblings = await db.query(
    `SELECT id FROM tree_nodes
     WHERE parent_node_id IS NOT DISTINCT FROM $1
     ORDER BY position ASC, id ASC`,
    [parent_node_id]
  );

  for (let i = 0; i < siblings.rows.length; i++) {
    await db.query(`UPDATE tree_nodes SET position = $1 WHERE id = $2`, [
      posToKey((i + 1) * 100),
      siblings.rows[i]["id"],
    ]);
  }
}

export async function selectNodeById(
  db: Queryable,
  id: string
): Promise<TreeNode | null> {
  const result = await db.query(`SELECT * FROM tree_nodes WHERE id = $1`, [id]);
  if (result.rows.length === 0) return null;
  return rowToNode(result.rows[0]);
}

export async function selectChildren(
  db: Queryable,
  parent_node_id: string | null
): Promise<TreeNode[]> {
  // Tie-break by id when two siblings share the same position key (cycle A1
  // allows this after UNIQUE removal). The (parent, position, id) BTREE index
  // introduced by migration 010 supports this ORDER BY without a sort step.
  const result = await db.query(
    `SELECT * FROM tree_nodes
     WHERE parent_node_id IS NOT DISTINCT FROM $1
     ORDER BY position ASC, id ASC`,
    [parent_node_id]
  );
  return result.rows.map(rowToNode);
}

export async function selectCanonicalNodeByCardId(
  db: Queryable,
  card_id: string
): Promise<TreeNode | null> {
  const result = await db.query(
    `SELECT * FROM tree_nodes WHERE card_id = $1 AND is_symlink = FALSE LIMIT 1`,
    [card_id]
  );
  if (result.rows.length === 0) return null;
  return rowToNode(result.rows[0]);
}

export async function getNodeBreadcrumb(
  db: Queryable,
  nodeId: string
): Promise<string[]> {
  const result = await db.query(
    `WITH RECURSIVE ancestors AS (
       SELECT tn.id, tn.parent_node_id, c.title, 0 AS depth
       FROM tree_nodes tn
       JOIN cards c ON c.id = tn.card_id
       WHERE tn.id = $1
       UNION ALL
       SELECT tn.id, tn.parent_node_id, c.title, a.depth + 1
       FROM tree_nodes tn
       JOIN cards c ON c.id = tn.card_id
       JOIN ancestors a ON tn.id = a.parent_node_id
     )
     SELECT title FROM ancestors ORDER BY depth DESC`,
    [nodeId]
  );
  return result.rows.map((r: any) => r.title as string);
}

export async function selectNodesByCardId(
  db: Queryable,
  card_id: string
): Promise<TreeNode[]> {
  const result = await db.query(
    `SELECT * FROM tree_nodes WHERE card_id = $1 ORDER BY created_at ASC`,
    [card_id]
  );
  return result.rows.map(rowToNode);
}

export async function deleteNodeById(
  db: Queryable,
  id: string
): Promise<boolean> {
  const result = await db.query(`DELETE FROM tree_nodes WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function moveNode(
  db: Queryable,
  nodeId: string,
  new_parent_node_id: string | null,
  new_position: number | undefined
): Promise<TreeNode | null> {
  const MAX_RETRIES = 3;
  const inTxn = isInTransaction(db);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let resolvedKey: string;
    if (new_position !== undefined) {
      resolvedKey = posToKey(new_position);
    } else {
      const maxResult = await db.query(
        `SELECT COALESCE(MAX(position), '0000000000') AS max_pos
         FROM tree_nodes
         WHERE parent_node_id IS NOT DISTINCT FROM $1
           AND id != $2
           AND position >= '0000000000'`,
        [new_parent_node_id, nodeId]
      );
      const maxNumeric = keyToPos(maxResult.rows[0]["max_pos"] as string);
      resolvedKey = posToKey(maxNumeric + 100);
    }

    const sp = `sp_move_node_${attempt}`;
    if (inTxn) await db.query(`SAVEPOINT ${sp}`);

    try {
      const result = await db.query(
        `UPDATE tree_nodes
         SET parent_node_id = $1, position = $2
         WHERE id = $3
         RETURNING *`,
        [new_parent_node_id, resolvedKey, nodeId]
      );
      if (inTxn) await db.query(`RELEASE SAVEPOINT ${sp}`);
      if (result.rows.length === 0) return null;
      return rowToNode(result.rows[0]);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === "23505" || code === "SQLITE_CONSTRAINT_UNIQUE") {
        // Cycle A1: dead branch (UNIQUE removed). Same rationale as insertNode.
        if (inTxn) await db.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        await renumberSiblings(db, new_parent_node_id);
      } else {
        if (inTxn) await db.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        throw err;
      }
    }
  }
  throw new Error(
    `moveNode: position conflict persists after ${MAX_RETRIES} retries (parent_node_id=${new_parent_node_id})`
  );
}

/**
 * Update tree-node properties.
 *
 * Partial-update semantics: a field is considered "provided" only when its
 * value is not `undefined`. Both "absent key" and "key present with value
 * `undefined`" mean "leave the column untouched" — this distinction is lost
 * once a payload passes through Zod/JSON boundaries, so we normalize here.
 * Explicit `null` still reaches the UPDATE and clears the column.
 *
 * Returns `{ node, updated }` so callers can distinguish a no-op (no
 * provided fields → no UPDATE issued) from a real update without re-checking
 * the input shape themselves. This is the single canonical guard for the
 * partial-update rule (design-principles §3); both `tree.service.ts` and
 * `batch.service.ts` consume the `updated` flag rather than re-deriving it.
 *
 * - `node`: the current row (always returned when the node exists), or `null`
 *   if the node was not found.
 * - `updated`: `true` iff at least one column was actually written to.
 *
 * Avoids the silent-overwrite bug where `{ }` or `{ journal_limit: undefined }`
 * would have blanked a previously-set `journal_limit`, and the asymmetric-
 * success bug where a no-op was reported as a successful update.
 */
export async function updateNodeProperties(
  db: Queryable,
  nodeId: string,
  props: { journal_limit?: number | null }
): Promise<{ node: TreeNode | null; updated: boolean }> {
  if (props.journal_limit === undefined) {
    const node = await selectNodeById(db, nodeId);
    return { node, updated: false };
  }
  const result = await db.query(
    `UPDATE tree_nodes SET journal_limit = $1 WHERE id = $2 RETURNING *`,
    [props.journal_limit, nodeId]
  );
  if (result.rows.length === 0) return { node: null, updated: false };
  return { node: rowToNode(result.rows[0]), updated: true };
}
