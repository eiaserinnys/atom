import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import type { DatabaseAdapter, Queryable } from "../adapter.js";
import type { QueryResult, QueryResultRow } from "pg";

/**
 * Translate PostgreSQL-dialect SQL to SQLite-compatible SQL.
 *
 * Handles:
 * - $1, $2, ... → ?
 * - IS NOT DISTINCT FROM $N → IS ?
 * - NOW() → datetime('now')
 * - BOOLEAN literals in result: SQLite returns 0/1 for boolean columns
 */
function translateQuery(sql: string): string {
  let translated = sql;

  // IS NOT DISTINCT FROM $N → IS ?
  translated = translated.replace(
    /IS\s+NOT\s+DISTINCT\s+FROM\s+\$\d+/gi,
    "IS ?"
  );

  // $1, $2, ... → ?
  translated = translated.replace(/\$\d+/g, "?");

  // NOW() → datetime('now')
  translated = translated.replace(/\bNOW\(\)/gi, "datetime('now')");

  return translated;
}

/**
 * Determine whether a SQL statement is a read query (SELECT/WITH or contains RETURNING).
 */
function isReadQuery(sql: string): boolean {
  const trimmed = sql.trimStart().toUpperCase();
  return (
    trimmed.startsWith("SELECT") ||
    trimmed.startsWith("WITH") ||
    /\bRETURNING\b/i.test(sql)
  );
}

export class SqliteAdapter implements DatabaseAdapter {
  readonly dbType = "sqlite" as const;
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  async query<T extends QueryResultRow = any>(
    queryText: string,
    values?: unknown[]
  ): Promise<QueryResult<T>> {
    const translated = translateQuery(queryText);
    const params = values ?? [];

    if (isReadQuery(queryText)) {
      const rows = this.db.prepare(translated).all(...params) as T[];
      return {
        rows,
        rowCount: rows.length,
        command: "",
        oid: 0,
        fields: [],
      };
    } else {
      const info = this.db.prepare(translated).run(...params);
      return {
        rows: [] as unknown as T[],
        rowCount: info.changes,
        command: "",
        oid: 0,
        fields: [],
      };
    }
  }

  async transaction<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
    const txClient: Queryable = {
      query: (sql, vals) => this.query(sql, vals),
      inTransaction: true,
    };

    this.db.exec("BEGIN");
    try {
      const result = await fn(txClient);
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }

  async runMigrations(migrationsDir: string): Promise<void> {
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      this.db.exec(sql);
    }
  }
}
