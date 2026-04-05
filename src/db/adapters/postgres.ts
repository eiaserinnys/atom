import pg from "pg";
import fs from "fs";
import path from "path";
import type { DatabaseAdapter, Queryable } from "../adapter.js";
import type { QueryResult, QueryResultRow } from "pg";

export class PostgresAdapter implements DatabaseAdapter {
  readonly dbType = 'postgres' as const;
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  async query<T extends QueryResultRow = any>(
    queryText: string, values?: unknown[]
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(queryText, values);
  }

  async transaction<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const txClient: Queryable = {
      query: (sql, vals) => client.query(sql, vals),
      inTransaction: true,
    };
    try {
      await client.query('BEGIN');
      const result = await fn(txClient);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async runMigrations(migrationsDir: string): Promise<void> {
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      await this.pool.query(sql);
    }
  }
}
