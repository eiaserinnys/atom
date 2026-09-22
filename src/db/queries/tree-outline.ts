import type { CardType, TreeOutlineNode } from "../../shared/types.js";
import type { Queryable } from "../queryable.js";
import { deserializeBoolean } from "../utils.js";
import { keyToPos } from "../../shared/lexorank.js";

export interface TreeOutlineRow {
  /** 1 = direct child of the requested parent. */
  level: number;
  node: TreeOutlineNode;
}

/**
 * Body-free outline of the subtree under `parentNodeId` (null = virtual root)
 * in ONE statement — no per-node queries.
 *
 * - `outline`: nodes down to `depth` levels (symlinks are leaves, not expanded).
 * - `reach`: every (outline node, descendant) pair at unlimited depth. UNION
 *   (not UNION ALL) also guarantees termination on a corrupted cyclic
 *   parent chain.
 * - `counts`: per outline node, direct children and all descendants.
 *
 * Each recursive step joins `tree_nodes` on `parent_node_id`
 * (idx_tree_nodes_parent / idx_tree_nodes_parent_pos_id). Written in the
 * Postgres dialect; SqliteAdapter translates `IS NOT DISTINCT FROM $1` and the
 * placeholders, so each placeholder appears exactly once, in order.
 *
 * Rows are ordered by level, then sibling order (position, id), so a parent
 * always precedes its children.
 */
export async function selectTreeOutlineRows(
  db: Queryable,
  parentNodeId: string | null,
  depth: number
): Promise<TreeOutlineRow[]> {
  const result = await db.query(
    `WITH RECURSIVE
     outline(id, parent_node_id, is_symlink, level) AS (
       SELECT tn.id, tn.parent_node_id, tn.is_symlink, 1
       FROM tree_nodes tn
       WHERE tn.parent_node_id IS NOT DISTINCT FROM $1
       UNION ALL
       SELECT tn.id, tn.parent_node_id, tn.is_symlink, o.level + 1
       FROM outline o
       JOIN tree_nodes tn ON tn.parent_node_id = o.id
       WHERE o.level < $2 AND o.is_symlink = FALSE
     ),
     reach(root_id, node_id, parent_id, is_symlink) AS (
       SELECT o.id, o.id, o.parent_node_id, o.is_symlink
       FROM outline o
       UNION
       SELECT r.root_id, tn.id, tn.parent_node_id, tn.is_symlink
       FROM reach r
       JOIN tree_nodes tn ON tn.parent_node_id = r.node_id
       WHERE r.is_symlink = FALSE
     ),
     counts(root_id, child_count, descendant_count) AS (
       SELECT root_id,
              SUM(CASE WHEN parent_id = root_id THEN 1 ELSE 0 END),
              COUNT(*) - 1
       FROM reach
       GROUP BY root_id
     )
     SELECT tn.id, tn.card_id, tn.parent_node_id, tn.position, tn.is_symlink,
            c.title, c.card_type, o.level,
            cnt.child_count, cnt.descendant_count
     FROM outline o
     JOIN tree_nodes tn ON tn.id = o.id
     JOIN cards c ON c.id = tn.card_id
     JOIN counts cnt ON cnt.root_id = o.id
     ORDER BY o.level ASC, tn.position ASC, tn.id ASC`,
    [parentNodeId, depth]
  );

  // pg returns COUNT/SUM (bigint) as strings; better-sqlite3 returns numbers.
  return result.rows.map((row: Record<string, unknown>) => ({
    level: Number(row["level"]),
    node: {
      id: row["id"] as string,
      card_id: row["card_id"] as string,
      parent_node_id: (row["parent_node_id"] as string | null) ?? null,
      position: keyToPos(row["position"] as string),
      is_symlink: deserializeBoolean(row["is_symlink"]),
      title: row["title"] as string,
      card_type: row["card_type"] as CardType,
      child_count: Number(row["child_count"]),
      descendant_count: Number(row["descendant_count"]),
      children: [],
    },
  }));
}
