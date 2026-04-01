import type pg from "pg";
import type { SearchResult } from "../../shared/types.js";

export async function searchByBm25(
  db: pg.Pool,
  query: string,
  limit: number = 20
): Promise<SearchResult[]> {
  // Join with tree_nodes to get node_id for each card (prefer canonical node)
  const result = await db.query(
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

  return result.rows.map((row) => ({
    card_id: row["card_id"] as string,
    node_id: (row["node_id"] as string | null) ?? null,
    title: row["title"] as string,
    card_type: row["card_type"] as SearchResult["card_type"],
    is_symlink: row["is_symlink"] as boolean,
    snippet: row["snippet"] as string,
  }));
}
