import type { Queryable } from "../queryable.js";
import type { SearchResult } from "../../shared/types.js";

export async function searchByBm25(
  db: Queryable,
  query: string,
  limit: number = 20,
  rootNodeId?: string
): Promise<SearchResult[]> {
  // Join with tree_nodes to get node_id for each card (prefer canonical node)
  // If rootNodeId is provided, restrict search to cards within that subtree via recursive CTE
  let result;
  if (rootNodeId) {
    result = await db.query(
      `WITH RECURSIVE subtree AS (
         SELECT id FROM tree_nodes WHERE id = $3
         UNION ALL
         SELECT tn.id FROM tree_nodes tn
         INNER JOIN subtree s ON tn.parent_node_id = s.id
       )
       SELECT
         c.id AS card_id,
         (SELECT tn.id FROM tree_nodes tn WHERE tn.card_id = c.id AND tn.is_symlink = FALSE LIMIT 1) AS node_id,
         c.title,
         c.card_type,
         FALSE AS is_symlink,
         ts_headline('simple',
           coalesce(c.content, c.title),
           plainto_tsquery('simple', $1),
           'MaxWords=20, MinWords=10'
         ) AS snippet
       FROM cards c
       WHERE c.fts_vector @@ plainto_tsquery('simple', $1)
         AND EXISTS (
           SELECT 1 FROM tree_nodes tn2
           WHERE tn2.card_id = c.id AND tn2.id IN (SELECT id FROM subtree)
         )
       ORDER BY ts_rank(c.fts_vector, plainto_tsquery('simple', $1)) DESC
       LIMIT $2`,
      [query, limit, rootNodeId]
    );
  } else {
    result = await db.query(
      `SELECT
         c.id AS card_id,
         (SELECT tn.id FROM tree_nodes tn WHERE tn.card_id = c.id AND tn.is_symlink = FALSE LIMIT 1) AS node_id,
         c.title,
         c.card_type,
         FALSE AS is_symlink,
         ts_headline('simple',
           coalesce(c.content, c.title),
           plainto_tsquery('simple', $1),
           'MaxWords=20, MinWords=10'
         ) AS snippet
       FROM cards c
       WHERE c.fts_vector @@ plainto_tsquery('simple', $1)
       ORDER BY ts_rank(c.fts_vector, plainto_tsquery('simple', $1)) DESC
       LIMIT $2`,
      [query, limit]
    );
  }

  return result.rows.map((row) => ({
    card_id: row["card_id"] as string,
    node_id: (row["node_id"] as string | null) ?? null,
    title: row["title"] as string,
    card_type: row["card_type"] as SearchResult["card_type"],
    is_symlink: row["is_symlink"] as boolean,
    snippet: row["snippet"] as string,
  }));
}
