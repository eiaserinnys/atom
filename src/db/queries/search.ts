import type { Queryable } from "../queryable.js";
import type { SearchResult, SearchFilters } from "../../shared/types.js";
import { getDb } from "../client.js";
import { deserializeBoolean } from "../utils.js";

export class SearchQueryInputError extends Error {
  readonly code = "SEARCH_QUERY_INVALID";
  readonly statusCode = 400;

  constructor() {
    super("Search query contains invalid syntax.");
    this.name = "SearchQueryInputError";
  }
}

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

  const occurrenceSelection = filters.root_node_id
    ? `LEFT JOIN LATERAL (
      SELECT tn.id AS node_id, tn.is_symlink
      FROM tree_nodes tn
      WHERE tn.card_id = c.id AND tn.id IN (SELECT id FROM subtree)
      ORDER BY tn.is_symlink ASC, tn.id ASC
      LIMIT 1
    ) selected_node ON TRUE`
    : `LEFT JOIN LATERAL (
      SELECT tn.id AS node_id, tn.is_symlink
      FROM tree_nodes tn
      WHERE tn.card_id = c.id AND tn.is_symlink = FALSE
      LIMIT 1
    ) selected_node ON TRUE`;

  // LIMIT is always the last parameter
  const limitIdx = idx;
  params.push(filters.limit ?? 20);

  const sql = `WITH RECURSIVE ${subtreeCte}tsq AS (
    SELECT websearch_to_tsquery('simple', $${queryIdx}) AS q
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
  ${occurrenceSelection}
  LEFT JOIN LATERAL (
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
  ) breadcrumb ON selected_node.node_id IS NOT NULL
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

function toSqliteFtsQuery(input: string): string | null {
  const groups: Array<{ positiveTerms: string[]; excludedTerms: string[]; hasTerms: boolean }> = [
    { positiveTerms: [], excludedTerms: [], hasTerms: false },
  ];
  let cursor = 0;

  while (cursor < input.length) {
    while (cursor < input.length && /\s/u.test(input[cursor]!)) cursor++;
    if (cursor >= input.length) break;

    let excluded = false;
    if (input[cursor] === "-" && cursor + 1 < input.length && !/\s/u.test(input[cursor + 1]!)) {
      excluded = true;
      cursor++;
    }

    let quoted = false;
    let term: string;
    if (input[cursor] === '"') {
      quoted = true;
      cursor++;
      let phrase = "";
      while (cursor < input.length) {
        if (input[cursor] === '"') {
          if (input[cursor + 1] === '"') {
            phrase += '"';
            cursor += 2;
            continue;
          }
          cursor++;
          break;
        }
        phrase += input[cursor];
        cursor++;
      }
      term = phrase;
    } else {
      const start = cursor;
      while (cursor < input.length && !/\s/u.test(input[cursor]!)) cursor++;
      term = input.slice(start, cursor);
    }

    if (term.length === 0) continue;
    if (!excluded && !quoted && term === "OR") {
      const current = groups.at(-1);
      if (!current?.hasTerms) throw new SearchQueryInputError();
      groups.push({ positiveTerms: [], excludedTerms: [], hasTerms: false });
      continue;
    }

    const ftsTerm = `"${term.replace(/"/g, '""')}"`;
    const group = groups.at(-1)!;
    group.hasTerms = true;
    if (excluded) group.excludedTerms.push(ftsTerm);
    else group.positiveTerms.push(ftsTerm);
  }

  if (groups.length > 1 && !groups.at(-1)!.hasTerms) throw new SearchQueryInputError();
  // Apply exclusions within each OR branch so alternatives retain websearch precedence.
  const expressions = groups
    .filter(group => group.positiveTerms.length > 0)
    .map(group => {
      let expression = group.positiveTerms.length === 1
        ? group.positiveTerms[0]!
        : `(${group.positiveTerms.join(" ")})`;
      for (const excluded of group.excludedTerms) expression = `${expression} NOT ${excluded}`;
      return expression;
    });
  if (expressions.length === 0) return null;

  return expressions.length === 1
    ? expressions[0]!
    : expressions.map(expression => `(${expression})`).join(" OR ");
}

function buildSqliteQuery(filters: SearchFilters, ftsQuery: string): { sql: string; params: unknown[] } {
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
  params.push(ftsQuery);
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
       ORDER BY rank
       LIMIT $${limitIdx}`;

  return { sql, params };
}

async function searchSqlite(db: Queryable, filters: SearchFilters) {
  const ftsQuery = toSqliteFtsQuery(filters.query);
  if (ftsQuery === null) return { rows: [] };

  const { sql, params } = buildSqliteQuery(filters, ftsQuery);
  try {
    return await db.query(sql, params);
  } catch (error) {
    if (isSqliteFtsSyntaxError(error)) throw new SearchQueryInputError();
    throw error;
  }
}

function isSqliteFtsSyntaxError(error: unknown): boolean {
  return error instanceof Error && /fts5: syntax error|unterminated string|no such column:/i.test(error.message);
}
