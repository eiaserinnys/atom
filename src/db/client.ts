import type { DatabaseAdapter } from "./adapter.js";
import { PostgresAdapter } from "./adapters/postgres.js";

let db: DatabaseAdapter | null = null;

export function getDb(): DatabaseAdapter {
  if (!db) {
    const databaseUrl = process.env["DATABASE_URL"];
    if (databaseUrl) {
      db = new PostgresAdapter(databaseUrl);
    } else {
      // Phase 2에서 SqliteAdapter 추가 예정
      throw new Error("DATABASE_URL environment variable is required (SQLite mode not yet implemented)");
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
