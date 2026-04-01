import pg from "pg";
import fs from "fs";
import path from "path";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const databaseUrl = process.env["DATABASE_URL"];
    if (!databaseUrl) {
      throw new Error("DATABASE_URL environment variable is required");
    }
    pool = new Pool({ connectionString: databaseUrl });
  }
  return pool;
}

export function setPool(p: pg.Pool): void {
  pool = p;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Run all SQL migration files in the given directory (sorted ascending).
 * @param migrationsDir Absolute path to the migrations folder.
 *   In production, pass `new URL("./migrations", import.meta.url).pathname` at the call site.
 *   In tests, pass an absolute path directly.
 */
export async function runMigrations(migrationsDir: string): Promise<void> {
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const db = getPool();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    await db.query(sql);
  }
}
