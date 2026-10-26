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
    const params = (values ?? []).map((value) =>
      typeof value === "boolean" ? (value ? 1 : 0) : value
    );

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
    // schema_migrations 테이블로 실행 이력을 추적하여 idempotent 동작 보장
    this.db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    const applied = new Set<string>(
      (this.db.prepare("SELECT name FROM schema_migrations").all() as { name: string }[])
        .map((r) => r.name)
    );
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      // PRAGMA foreign_keys cannot change inside a transaction. Keep the table
      // swap and its completion record atomic, checking references before commit.
      const foreignKeys = this.db.pragma("foreign_keys", { simple: true });
      this.db.pragma("foreign_keys = OFF");
      try {
        this.db.transaction(() => {
          if (file === "013_drop_unused_card_fields.sql") {
            // Older runners could stop after DROP cards, leaving the only copy
            // in cards_new. Recover it before 013 removes its scratch table.
            const hasTable = (name: string) => this.db.prepare(
              "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
            ).get(name);
            if (!hasTable("cards") && hasTable("cards_new")) {
              this.db.exec("ALTER TABLE cards_new RENAME TO cards");
            }
          }
          this.db.exec(sql);
          if (this.db.prepare("PRAGMA foreign_key_check").all().length > 0) {
            throw new Error(`Foreign key violation after SQLite migration ${file}`);
          }
          this.db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(file);
        })();
      } finally {
        this.db.pragma(`foreign_keys = ${foreignKeys}`);
      }
    }
  }
}
