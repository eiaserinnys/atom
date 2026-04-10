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
    node_path: (row["node_path"] as string[] | null) ?? [],
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
       ), tsq AS (
         SELECT websearch_to_tsquery('simple', $1) AS q
       )
       SELECT
         c.id AS card_id,
         canonical_node.node_id,
         c.title,
         c.card_type,
         FALSE AS is_symlink,
         ts_headline('simple',
           coalesce(c.content, c.title),
           tsq.q,
           'MaxWords=20, MinWords=10'
         ) AS snippet,
         COALESCE(breadcrumb.path, '{}') AS node_path
       FROM cards c, tsq
       LEFT JOIN LATERAL (
         SELECT tn.id AS node_id
         FROM tree_nodes tn
         WHERE tn.card_id = c.id AND tn.is_symlink = FALSE
         LIMIT 1
       ) canonical_node ON TRUE
       LEFT JOIN LATERAL (
         WITH RECURSIVE anc AS (
           SELECT tn.parent_node_id, ac.title, 1 AS depth
           FROM tree_nodes tn
           JOIN cards ac ON ac.id = tn.card_id
           WHERE tn.id = canonical_node.node_id
           UNION ALL
           SELECT tn.parent_node_id, ac.title, a.depth + 1
           FROM tree_nodes tn
           JOIN cards ac ON ac.id = tn.card_id
           INNER JOIN anc a ON tn.id = a.parent_node_id
         )
         SELECT array_agg(title ORDER BY depth DESC) AS path
         FROM anc
         WHERE depth > 1
       ) breadcrumb ON canonical_node.node_id IS NOT NULL
       WHERE c.fts_vector @@ tsq.q
         AND EXISTS (
           SELECT 1 FROM tree_nodes tn2
           WHERE tn2.card_id = c.id AND tn2.id IN (SELECT id FROM subtree)
         )
       ORDER BY ts_rank(c.fts_vector, tsq.q) DESC
       LIMIT $2`,
      [query, limit, rootNodeId]
    );
  } else {
    return db.query(
      `WITH tsq AS (
         SELECT websearch_to_tsquery('simple', $1) AS q
       )
       SELECT
         c.id AS card_id,
         canonical_node.node_id,
         c.title,
         c.card_type,
         FALSE AS is_symlink,
         ts_headline('simple',
           coalesce(c.content, c.title),
           tsq.q,
           'MaxWords=20, MinWords=10'
         ) AS snippet,
         COALESCE(breadcrumb.path, '{}') AS node_path
       FROM cards c, tsq
       LEFT JOIN LATERAL (
         SELECT tn.id AS node_id
         FROM tree_nodes tn
         WHERE tn.card_id = c.id AND tn.is_symlink = FALSE
         LIMIT 1
       ) canonical_node ON TRUE
       LEFT JOIN LATERAL (
         WITH RECURSIVE anc AS (
           SELECT tn.parent_node_id, ac.title, 1 AS depth
           FROM tree_nodes tn
           JOIN cards ac ON ac.id = tn.card_id
           WHERE tn.id = canonical_node.node_id
           UNION ALL
           SELECT tn.parent_node_id, ac.title, a.depth + 1
           FROM tree_nodes tn
           JOIN cards ac ON ac.id = tn.card_id
           INNER JOIN anc a ON tn.id = a.parent_node_id
         )
         SELECT array_agg(title ORDER BY depth DESC) AS path
         FROM anc
         WHERE depth > 1
       ) breadcrumb ON canonical_node.node_id IS NOT NULL
       WHERE c.fts_vector @@ tsq.q
       ORDER BY ts_rank(c.fts_vector, tsq.q) DESC
       LIMIT $2`,
      [query, limit]
    );
  }
}
