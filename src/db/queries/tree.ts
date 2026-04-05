import type { TreeNode } from "../../shared/types.js";
import type { Queryable } from "../queryable.js";

function rowToNode(row: Record<string, unknown>): TreeNode {
  return {
    id: row["id"] as string,
    card_id: row["card_id"] as string,
    parent_node_id: (row["parent_node_id"] as string | null) ?? null,
    position: row["position"] as number,
    is_symlink: row["is_symlink"] as boolean,
    created_at: row["created_at"] as string,
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
    let resolvedPosition: number;
    if (position !== undefined) {
      resolvedPosition = position;
    } else {
      const maxResult = await db.query(
        `SELECT COALESCE(MAX(position), 0) AS max_pos
         FROM tree_nodes WHERE parent_node_id IS NOT DISTINCT FROM $1`,
        [parent_node_id]
      );
      resolvedPosition = (maxResult.rows[0]["max_pos"] as number) + 100;
    }

    const sp = `sp_insert_node_${attempt}`;
    if (inTxn) await db.query(`SAVEPOINT ${sp}`);

    try {
      const result = await db.query(
        `INSERT INTO tree_nodes (card_id, parent_node_id, position, is_symlink)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [card_id, parent_node_id, resolvedPosition, is_symlink]
      );
      if (inTxn) await db.query(`RELEASE SAVEPOINT ${sp}`);
      return rowToNode(result.rows[0]);
    } catch (err: unknown) {
      if ((err as { code?: string }).code === "23505") {
        // PostgreSQL unique_violation: rollback to savepoint (if in txn) then renumber and retry
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
  // Fetch all siblings ordered by current position, reassign 100, 200, 300...
  const siblings = await db.query(
    `SELECT id FROM tree_nodes
     WHERE parent_node_id IS NOT DISTINCT FROM $1
     ORDER BY position ASC`,
    [parent_node_id]
  );

  for (let i = 0; i < siblings.rows.length; i++) {
    await db.query(`UPDATE tree_nodes SET position = $1 WHERE id = $2`, [
      (i + 1) * 100,
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
  const result = await db.query(
    `SELECT * FROM tree_nodes
     WHERE parent_node_id IS NOT DISTINCT FROM $1
     ORDER BY position ASC`,
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
    let resolvedPosition: number;
    if (new_position !== undefined) {
      resolvedPosition = new_position;
    } else {
      const maxResult = await db.query(
        `SELECT COALESCE(MAX(position), 0) AS max_pos
         FROM tree_nodes WHERE parent_node_id IS NOT DISTINCT FROM $1 AND id != $2`,
        [new_parent_node_id, nodeId]
      );
      resolvedPosition = (maxResult.rows[0]["max_pos"] as number) + 100;
    }

    const sp = `sp_move_node_${attempt}`;
    if (inTxn) await db.query(`SAVEPOINT ${sp}`);

    try {
      const result = await db.query(
        `UPDATE tree_nodes
         SET parent_node_id = $1, position = $2
         WHERE id = $3
         RETURNING *`,
        [new_parent_node_id, resolvedPosition, nodeId]
      );
      if (inTxn) await db.query(`RELEASE SAVEPOINT ${sp}`);
      if (result.rows.length === 0) return null;
      return rowToNode(result.rows[0]);
    } catch (err: unknown) {
      if ((err as { code?: string }).code === "23505") {
        // PostgreSQL unique_violation: rollback to savepoint (if in txn) then renumber and retry
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
