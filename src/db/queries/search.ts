import type { Queryable } from "../queryable.js";
import type { SearchResult, SearchFilters } from "../../shared/types.js";
import { getDb } from "../client.js";
import { deserializeBoolean } from "../utils.js";
import { getNodeBreadcrumbs } from "./tree.js";
import {
  SearchQueryInputError,
  buildPostgresTsqueryTexts,
  buildSqliteFtsQueries,
  type SearchMatchQueries,
} from "./search-query.js";

export { SearchQueryInputError };

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

  // $1: tsquery text with prefix words, $2: same query with whole words (ranking)
  const tsqueryTexts = buildPostgresTsqueryTexts(filters.query);
  params.push(tsqueryTexts.prefix, tsqueryTexts.whole);
  const queryIdx = idx++;
  const wholeQueryIdx = idx++;

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
      UNION
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

  const subtreeOccurrence = (cardIdRef: string) => `LEFT JOIN LATERAL (
      SELECT tn.id AS node_id, tn.is_symlink
      FROM tree_nodes tn
      WHERE tn.card_id = ${cardIdRef} AND tn.id IN (SELECT id FROM subtree)
      ORDER BY tn.is_symlink ASC, tn.id ASC
      LIMIT 1
    ) selected_node ON TRUE`;

  const breadcrumbSelection = `LEFT JOIN LATERAL (
    WITH RECURSIVE anc AS (
      SELECT tn.parent_node_id, ac.title, 1 AS depth, ARRAY[tn.id] AS visited
      FROM tree_nodes tn
      JOIN cards ac ON ac.id = tn.card_id
      WHERE tn.id = selected_node.node_id
      UNION ALL
      SELECT tn.parent_node_id, ac.title, a.depth + 1, a.visited || tn.id
      FROM tree_nodes tn
      JOIN cards ac ON ac.id = tn.card_id
      INNER JOIN anc a ON tn.id = a.parent_node_id
      WHERE NOT tn.id = ANY(a.visited)
    )
    SELECT array_agg(title ORDER BY depth DESC) AS path
    FROM anc
    WHERE depth > 1
  ) breadcrumb ON selected_node.node_id IS NOT NULL`;

  // LIMIT is always the last parameter
  const limitIdx = idx;
  params.push(filters.limit ?? 20);

  // Scoped search ranks and cuts to the top cards first so the per-card
  // occurrence, breadcrumb and headline work runs for `limit` cards only.
  if (filters.root_node_id) {
    const sql = `WITH RECURSIVE ${subtreeCte}tsq AS (
    SELECT to_tsquery('simple', $${queryIdx}) AS q, to_tsquery('simple', $${wholeQueryIdx}) AS whole_q
  ), top AS (
    SELECT c.id, c.title, c.card_type, c.content,
      (c.fts_vector @@ tsq.whole_q) AS whole_match,
      ts_rank(c.fts_vector, tsq.q) AS rank
    FROM cards c, tsq
    WHERE ${conditions.join("\n      AND ")}
    ORDER BY whole_match DESC, rank DESC, c.id ASC
    LIMIT $${limitIdx}
  )
  SELECT
    top.id AS card_id,
    selected_node.node_id,
    top.title,
    top.card_type,
    COALESCE(selected_node.is_symlink, FALSE) AS is_symlink,
    ts_headline('simple',
      coalesce(top.content, top.title),
      tsq.q,
      'MaxWords=20, MinWords=10'
    ) AS snippet,
    COALESCE(breadcrumb.path, '{}') AS node_path
  FROM top, tsq
  ${subtreeOccurrence("top.id")}
  ${breadcrumbSelection}
  ORDER BY top.whole_match DESC, top.rank DESC, top.id ASC`;
    return { sql, params };
  }

  const sql = `WITH RECURSIVE tsq AS (
    SELECT to_tsquery('simple', $${queryIdx}) AS q, to_tsquery('simple', $${wholeQueryIdx}) AS whole_q
  )
  SELECT
    c.id AS card_id,
    selected_node.node_id,
    c.title,
    c.card_type,
    COALESCE(selected_node.is_symlink, FALSE) AS is_symlink,
    ts_headline('simple',
      coalesce(c.content, c.title),
      tsq.q,
      'MaxWords=20, MinWords=10'
    ) AS snippet,
    COALESCE(breadcrumb.path, '{}') AS node_path
  FROM cards c, tsq
  LEFT JOIN LATERAL (
    SELECT tn.id AS node_id, tn.is_symlink
    FROM tree_nodes tn
    WHERE tn.card_id = c.id AND tn.is_symlink = FALSE
    LIMIT 1
  ) selected_node ON TRUE
  ${breadcrumbSelection}
  WHERE ${conditions.join("\n    AND ")}
  ORDER BY (c.fts_vector @@ tsq.whole_q) DESC, ts_rank(c.fts_vector, tsq.q) DESC
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

function buildSqliteQuery(filters: SearchFilters, ftsQueries: SearchMatchQueries): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  let idx = 1;

  // Bind parameters in generated SQL order: subtree CTE, FTS query, filters, LIMIT.
  let subtreeCte = "";
  if (filters.root_node_id) {
    const subtreeIdx = idx++;
    params.push(filters.root_node_id);
    subtreeCte = `WITH RECURSIVE subtree AS (
       SELECT id FROM tree_nodes WHERE id = $${subtreeIdx}
       UNION
       SELECT tn.id FROM tree_nodes tn
       INNER JOIN subtree s ON tn.parent_node_id = s.id
     )
     `;
  }

  // FTS query follows the CTE placeholder, when present.
  params.push(ftsQueries.prefix);
  const matchIdx = idx++;

  // Additional WHERE conditions beyond FTS MATCH
  // LIMIT is pushed last to keep params in SQL appearance order.
  // translateQuery replaces $N → ? positionally, so params must match
  // the order $N placeholders appear in the generated SQL.
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
    extraConditions.push(`julianday(c.updated_at) >= julianday($${idx})`);
    params.push(filters.updated_after);
    idx++;
  }

  if (filters.updated_before) {
    extraConditions.push(`julianday(c.updated_at) <= julianday($${idx})`);
    params.push(filters.updated_before);
    idx++;
  }

  if (filters.source_type) {
    extraConditions.push(`c.source_type = $${idx}`);
    params.push(filters.source_type);
    idx++;
  }

  if (filters.root_node_id) {
    extraConditions.push(`EXISTS (
      SELECT 1 FROM tree_nodes tn2
      WHERE tn2.card_id = c.id AND tn2.id IN (SELECT id FROM subtree)
    )`);
  }

  const whereExtra = extraConditions.length > 0
    ? "\n         AND " + extraConditions.join("\n         AND ")
    : "";

  let wholeFirstOrder = "";
  if (ftsQueries.whole !== ftsQueries.prefix) {
    const wholeIdx = idx++;
    params.push(ftsQueries.whole);
    wholeFirstOrder = `(c.rowid IN (SELECT rowid FROM cards_fts WHERE cards_fts MATCH $${wholeIdx})) DESC, `;
  }

  // LIMIT is always the last parameter (matches SQL appearance order)
  const limitIdx = idx;
  params.push(filters.limit ?? 20);

  const occurrenceFilter = filters.root_node_id
    ? "AND tn.id IN (SELECT id FROM subtree)"
    : "AND tn.is_symlink = 0";
  const occurrenceOrder = filters.root_node_id ? "ORDER BY tn.is_symlink ASC, tn.id ASC" : "";
  const nodeIdSelection = `(SELECT tn.id FROM tree_nodes tn WHERE tn.card_id = c.id ${occurrenceFilter} ${occurrenceOrder} LIMIT 1)`;
  const isSymlinkSelection = filters.root_node_id
    ? `(SELECT tn.is_symlink FROM tree_nodes tn WHERE tn.card_id = c.id ${occurrenceFilter} ${occurrenceOrder} LIMIT 1)`
    : "0";

  const sql = `${subtreeCte}SELECT
         c.id AS card_id,
         ${nodeIdSelection} AS node_id,
         c.title,
         c.card_type,
         ${isSymlinkSelection} AS is_symlink,
         snippet(cards_fts, -1, '<b>', '</b>', '...', 20) AS snippet
       FROM cards_fts
       JOIN cards c ON c.rowid = cards_fts.rowid
       WHERE cards_fts MATCH $${matchIdx}${whereExtra}
       ORDER BY ${wholeFirstOrder}rank
       LIMIT $${limitIdx}`;

  return { sql, params };
}

async function searchSqlite(db: Queryable, filters: SearchFilters) {
  const ftsQueries = buildSqliteFtsQueries(filters.query);
  if (ftsQueries === null) return { rows: [] };

  const { sql, params } = buildSqliteQuery(filters, ftsQueries);
  let result;
  try {
    result = await db.query(sql, params);
  } catch (error) {
    if (isSqliteFtsSyntaxError(error)) throw new SearchQueryInputError();
    throw error;
  }
  return { rows: await withSqliteNodePaths(db, result.rows) };
}

async function withSqliteNodePaths(db: Queryable, rows: Record<string, unknown>[]) {
  const nodeIds = rows.map(row => row["node_id"]).filter((id): id is string => typeof id === "string");
  const breadcrumbs = await getNodeBreadcrumbs(db, nodeIds);
  return rows.map(row => {
    const titles = breadcrumbs.get(row["node_id"] as string) ?? [];
    return { ...row, node_path: titles.slice(0, -1) };
  });
}

function isSqliteFtsSyntaxError(error: unknown): boolean {
  return error instanceof Error && /fts5: syntax error|unterminated string|no such column:/i.test(error.message);
}
