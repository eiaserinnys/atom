import type { Queryable } from "../queryable.js";
import type { SearchResult, SearchFilters } from "../../shared/types.js";
import { getDb } from "../client.js";
import { deserializeBoolean } from "../utils.js";

export async function searchByBm25(
  db: Queryable,
  filters: SearchFilters
): Promise<SearchResult[]> {
  const dbType = getDb().dbType;
  let result;

  if (dbType === "sqlite") {
    result = await searchSqlite(db, filters);
  } else {
    result = await searchPostgres(db, filters);
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

// ---------------------------------------------------------------------------
// PostgreSQL dynamic query builder
// ---------------------------------------------------------------------------

function buildPostgresQuery(filters: SearchFilters): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  let idx = 1;

  // $1: FTS query (always present)
  params.push(filters.query);
  const queryIdx = idx++;

  // Dynamic WHERE conditions — fts_vector match is always included
  const conditions: string[] = ["c.fts_vector @@ tsq.q"];

  if (filters.tags && filters.tags.length > 0) {
    conditions.push(`c.tags @> $${idx}::text[]`);
    params.push(filters.tags);
    idx++;
  }

  if (filters.card_type) {
    conditions.push(`c.card_type = $${idx}`);
    params.push(filters.card_type);
    idx++;
  }

  if (filters.updated_after) {
    conditions.push(`c.updated_at >= $${idx}::timestamptz`);
    params.push(filters.updated_after);
    idx++;
  }

  if (filters.updated_before) {
    conditions.push(`c.updated_at <= $${idx}::timestamptz`);
    params.push(filters.updated_before);
    idx++;
  }

  if (filters.source_type) {
    conditions.push(`c.source_type = $${idx}`);
    params.push(filters.source_type);
    idx++;
  }

  // Optional subtree CTE
  let subtreeCte = "";
  if (filters.root_node_id) {
    subtreeCte = `subtree AS (
      SELECT id FROM tree_nodes WHERE id = $${idx}
      UNION ALL
      SELECT tn.id FROM tree_nodes tn
      INNER JOIN subtree s ON tn.parent_node_id = s.id
    ), `;
    params.push(filters.root_node_id);
    idx++;
    conditions.push(`EXISTS (
      SELECT 1 FROM tree_nodes tn2
      WHERE tn2.card_id = c.id AND tn2.id IN (SELECT id FROM subtree)
    )`);
  }

  // LIMIT is always the last parameter
  const limitIdx = idx;
  params.push(filters.limit ?? 20);

  const sql = `WITH RECURSIVE ${subtreeCte}tsq AS (
    SELECT websearch_to_tsquery('simple', $${queryIdx}) AS q
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
  WHERE ${conditions.join("\n    AND ")}
  ORDER BY ts_rank(c.fts_vector, tsq.q) DESC
  LIMIT $${limitIdx}`;

  return { sql, params };
}

async function searchPostgres(db: Queryable, filters: SearchFilters) {
  const { sql, params } = buildPostgresQuery(filters);
  return db.query(sql, params);
}

// ---------------------------------------------------------------------------
// SQLite dynamic query builder
// ---------------------------------------------------------------------------
// SQLite is used only for unit tests. breadcrumb (node_path) is intentionally
// not implemented here — all results return node_path: [] via the result mapper.

function buildSqliteQuery(filters: SearchFilters): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  let idx = 1;

  // $1: FTS query
  params.push(filters.query);
  const matchIdx = idx++;

  // $2: LIMIT (reserved early, but appended to SQL at the end)
  params.push(filters.limit ?? 20);
  const limitIdx = idx++;

  // Additional WHERE conditions beyond FTS MATCH
  const extraConditions: string[] = [];

  // tags filter: each tag requires a separate EXISTS check (AND semantics)
  if (filters.tags && filters.tags.length > 0) {
    for (const tag of filters.tags) {
      extraConditions.push(
        `EXISTS (SELECT 1 FROM json_each(c.tags) WHERE json_each.value = $${idx})`
      );
      params.push(tag);
      idx++;
    }
  }

  if (filters.card_type) {
    extraConditions.push(`c.card_type = $${idx}`);
    params.push(filters.card_type);
    idx++;
  }

  if (filters.updated_after) {
    extraConditions.push(`c.updated_at >= $${idx}`);
    params.push(filters.updated_after);
    idx++;
  }

  if (filters.updated_before) {
    extraConditions.push(`c.updated_at <= $${idx}`);
    params.push(filters.updated_before);
    idx++;
  }

  if (filters.source_type) {
    extraConditions.push(`c.source_type = $${idx}`);
    params.push(filters.source_type);
    idx++;
  }

  // Optional subtree CTE
  let subtreeCte = "";
  if (filters.root_node_id) {
    subtreeCte = `WITH RECURSIVE subtree AS (
       SELECT id FROM tree_nodes WHERE id = $${idx}
       UNION ALL
       SELECT tn.id FROM tree_nodes tn
       INNER JOIN subtree s ON tn.parent_node_id = s.id
     )
     `;
    params.push(filters.root_node_id);
    idx++;
    extraConditions.push(`EXISTS (
      SELECT 1 FROM tree_nodes tn2
      WHERE tn2.card_id = c.id AND tn2.id IN (SELECT id FROM subtree)
    )`);
  }

  const whereExtra = extraConditions.length > 0
    ? "\n         AND " + extraConditions.join("\n         AND ")
    : "";

  const sql = `${subtreeCte}SELECT
         c.id AS card_id,
         (SELECT tn.id FROM tree_nodes tn WHERE tn.card_id = c.id AND tn.is_symlink = 0 LIMIT 1) AS node_id,
         c.title,
         c.card_type,
         0 AS is_symlink,
         snippet(cards_fts, -1, '<b>', '</b>', '...', 20) AS snippet
       FROM cards_fts
       JOIN cards c ON c.rowid = cards_fts.rowid
       WHERE cards_fts MATCH $${matchIdx}${whereExtra}
       ORDER BY rank
       LIMIT $${limitIdx}`;

  return { sql, params };
}

async function searchSqlite(db: Queryable, filters: SearchFilters) {
  const { sql, params } = buildSqliteQuery(filters);
  return db.query(sql, params);
}
