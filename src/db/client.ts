import path from "path";
import type { DatabaseAdapter } from "./adapter.js";
import { PostgresAdapter } from "./adapters/postgres.js";
import { SqliteAdapter } from "./adapters/sqlite.js";

let db: DatabaseAdapter | null = null;

export function getDb(): DatabaseAdapter {
  if (!db) {
    const databaseUrl = process.env["DATABASE_URL"];
    if (databaseUrl) {
      db = new PostgresAdapter(databaseUrl);
    } else {
      const sqlitePath =
        process.env["SQLITE_PATH"] ?? path.join(process.cwd(), "atom.db");
      db = new SqliteAdapter(sqlitePath);
    }
  }
  return db;
}

export function setDb(adapter: DatabaseAdapter): void { db = adapter; }
export async function closeDb(): Promise<void> { if (db) { await db.close(); db = null; } }

// 하위 호환 re-export
export const getPool = getDb;
export const setPool = setDb;
export const closePool = closeDb;

export async function runMigrations(migrationsDir: string): Promise<void> {
  return getDb().runMigrations(migrationsDir);
}
