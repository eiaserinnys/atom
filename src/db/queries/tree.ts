import type pg from "pg";
import type { TreeNode } from "../../shared/types.js";

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

export async function insertNode(
  db: pg.Pool,
  card_id: string,
  parent_node_id: string | null,
  position: number | undefined,
  is_symlink: boolean = false
): Promise<TreeNode> {
  let resolvedPosition: number;

  if (position !== undefined) {
    // Check for conflict
    const conflict = await db.query(
      `SELECT id FROM tree_nodes WHERE parent_node_id IS NOT DISTINCT FROM $1 AND position = $2`,
      [parent_node_id, position]
    );

    if ((conflict.rowCount ?? 0) > 0) {
      // Renumber siblings in a single transaction
      await renumberSiblings(db, parent_node_id);
    }
    resolvedPosition = position;
  } else {
    // Auto-assign: max sibling position + 100, or 100 if none
    const maxResult = await db.query(
      `SELECT COALESCE(MAX(position), 0) AS max_pos
       FROM tree_nodes WHERE parent_node_id IS NOT DISTINCT FROM $1`,
      [parent_node_id]
    );
    resolvedPosition = (maxResult.rows[0]["max_pos"] as number) + 100;
  }

  const result = await db.query(
    `INSERT INTO tree_nodes (card_id, parent_node_id, position, is_symlink)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [card_id, parent_node_id, resolvedPosition, is_symlink]
  );
  return rowToNode(result.rows[0]);
}

async function renumberSiblings(
  db: pg.Pool,
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
  db: pg.Pool,
  id: string
): Promise<TreeNode | null> {
  const result = await db.query(`SELECT * FROM tree_nodes WHERE id = $1`, [id]);
  if (result.rows.length === 0) return null;
  return rowToNode(result.rows[0]);
}

export async function selectChildren(
  db: pg.Pool,
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
  db: pg.Pool,
  card_id: string
): Promise<TreeNode | null> {
  const result = await db.query(
    `SELECT * FROM tree_nodes WHERE card_id = $1 AND is_symlink = FALSE LIMIT 1`,
    [card_id]
  );
  if (result.rows.length === 0) return null;
  return rowToNode(result.rows[0]);
}

export async function selectNodesByCardId(
  db: pg.Pool,
  card_id: string
): Promise<TreeNode[]> {
  const result = await db.query(
    `SELECT * FROM tree_nodes WHERE card_id = $1 ORDER BY created_at ASC`,
    [card_id]
  );
  return result.rows.map(rowToNode);
}

export async function deleteNodeById(
  db: pg.Pool,
  id: string
): Promise<boolean> {
  const result = await db.query(`DELETE FROM tree_nodes WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function moveNode(
  db: pg.Pool,
  nodeId: string,
  new_parent_node_id: string | null,
  new_position: number | undefined
): Promise<TreeNode | null> {
  let resolvedPosition: number;

  if (new_position !== undefined) {
    const conflict = await db.query(
      `SELECT id FROM tree_nodes
       WHERE parent_node_id IS NOT DISTINCT FROM $1 AND position = $2 AND id != $3`,
      [new_parent_node_id, new_position, nodeId]
    );
    if ((conflict.rowCount ?? 0) > 0) {
      await renumberSiblings(db, new_parent_node_id);
    }
    resolvedPosition = new_position;
  } else {
    const maxResult = await db.query(
      `SELECT COALESCE(MAX(position), 0) AS max_pos
       FROM tree_nodes WHERE parent_node_id IS NOT DISTINCT FROM $1 AND id != $2`,
      [new_parent_node_id, nodeId]
    );
    resolvedPosition = (maxResult.rows[0]["max_pos"] as number) + 100;
  }

  const result = await db.query(
    `UPDATE tree_nodes
     SET parent_node_id = $1, position = $2
     WHERE id = $3
     RETURNING *`,
    [new_parent_node_id, resolvedPosition, nodeId]
  );
  if (result.rows.length === 0) return null;
  return rowToNode(result.rows[0]);
}
