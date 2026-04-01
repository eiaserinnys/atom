import type { QueryResult, QueryResultRow } from "pg";

/**
 * Common interface implemented by both pg.Pool and pg.PoolClient.
 * DB-layer functions accept this instead of pg.Pool so they can be
 * called both from the Pool singleton and from within a transaction client.
 */
export interface Queryable {
  // Default generic matches pg.Pool behaviour (any, not QueryResultRow)
  // so existing callers that rely on implicit any remain type-safe.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T extends QueryResultRow = any>(
    queryText: string,
    values?: unknown[]
  ): Promise<QueryResult<T>>;
}
