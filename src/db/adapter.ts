import type { QueryResult, QueryResultRow } from "pg";

export interface Queryable {
  query<T extends QueryResultRow = any>(
    queryText: string,
    values?: unknown[]
  ): Promise<QueryResult<T>>;
  readonly inTransaction?: boolean;
}

export interface DatabaseAdapter extends Queryable {
  readonly dbType: 'postgres' | 'sqlite';
  transaction<T>(fn: (client: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  runMigrations(migrationsDir: string): Promise<void>;
}
