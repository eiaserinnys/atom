import type { Queryable } from "../queryable.js";
import type { SearchResult } from "../../shared/types.js";
import { getDb } from "../client.js";
import { deserializeBoolean } from "../utils.js";

export async function searchByBm25(
  db: Queryable,
  query: string,
  limit: number = 20,
  rootNodeId?: string
): Promise<SearchResult[]> {
  const dbType = getDb().dbType;
  let result;

  if (dbType === "sqlite") {
    result = await searchSqlite(db, query, limit, rootNodeId);
  } else {
    result = await searchPostgres(db, query, limit, rootNodeId);
  }

  return result.rows.map((row: Record<string, unknown>) => ({
    card_id: row["card_id"] as string,
    node_id: (row["node_id"] as string | null) ?? null,
    title: row["title"] as string,
    card_type: row["card_type"] as SearchResult["card_type"],
    is_symlink: deserializeBoolean(row["is_symlink"]),
    snippet: row["snippet"] as string,
  }));
}

async function searchSqlite(
  db: Queryable,
  query: string,
  limit: number,
  rootNodeId?: string
) {
  if (rootNodeId) {
    return db.query(
      `WITH RECURSIVE subtree AS (
         SELECT id FROM tree_nodes WHERE id = $3
         UNION ALL
         SELECT tn.id FROM tree_nodes tn
         INNER JOIN subtree s ON tn.parent_node_id = s.id
       )
       SELECT
         c.id AS card_id,
         (SELECT tn.id FROM tree_nodes tn WHERE tn.card_id = c.id AND tn.is_symlink = 0 LIMIT 1) AS node_id,
         c.title,
         c.card_type,
         0 AS is_symlink,
         snippet(cards_fts, -1, '<b>', '</b>', '...', 20) AS snippet
       FROM cards_fts
       JOIN cards c ON c.rowid = cards_fts.rowid
       WHERE cards_fts MATCH $1
         AND EXISTS (
           SELECT 1 FROM tree_nodes tn2
           WHERE tn2.card_id = c.id AND tn2.id IN (SELECT id FROM subtree)
         )
       ORDER BY rank
       LIMIT $2`,
      [query, limit, rootNodeId]
    );
  } else {
    return db.query(
      `SELECT
         c.id AS card_id,
         (SELECT tn.id FROM tree_nodes tn WHERE tn.card_id = c.id AND tn.is_symlink = 0 LIMIT 1) AS node_id,
         c.title,
         c.card_type,
         0 AS is_symlink,
         snippet(cards_fts, -1, '<b>', '</b>', '...', 20) AS snippet
       FROM cards_fts
       JOIN cards c ON c.rowid = cards_fts.rowid
       WHERE cards_fts MATCH $1
       ORDER BY rank
       LIMIT $2`,
      [query, limit]
    );
  }
}

async function searchPostgres(
  db: Queryable,
  query: string,
  limit: number,
  rootNodeId?: string
) {
  if (rootNodeId) {
    return db.query(
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
    return db.query(
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
}
