import path from "path";
import { fileURLToPath } from "url";

import { closePool, runMigrations, setPool } from "../../src/db/client.js";
import { PostgresAdapter } from "../../src/db/adapters/postgres.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations");

let pool: PostgresAdapter | null = null;

export function getIntegrationTestPool(): PostgresAdapter {
  if (!pool) {
    throw new Error("Integration test pool was not initialized");
  }

  return pool;
}

export function assertSafeTestDatabaseUrl(databaseUrl: string): void {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error(
      "TEST_DATABASE_URL is invalid (database: unavailable, host: unavailable)"
    );
  }

  const host = parsedUrl.host || "unavailable";
  const encodedDatabaseName = parsedUrl.pathname.startsWith("/")
    ? parsedUrl.pathname.slice(1)
    : parsedUrl.pathname;
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(encodedDatabaseName);
  } catch {
    throw new Error(
      `TEST_DATABASE_URL has an invalid database name (database: "${encodedDatabaseName || "(empty)"}", host: "${host}")`
    );
  }

  if (!databaseName) {
    throw new Error(
      `TEST_DATABASE_URL must include a database name (database: "(empty)", host: "${host}")`
    );
  }

  if (!databaseName.toLowerCase().includes("test")) {
    throw new Error(
      `TEST_DATABASE_URL must target a test database (database: "${databaseName}", host: "${host}")`
    );
  }
}

export function setupIntegrationTestDb(): void {
  beforeAll(async () => {
    const databaseUrl = process.env["TEST_DATABASE_URL"];
    if (!databaseUrl) {
      throw new Error(
        "TEST_DATABASE_URL is required for integration tests.\n" +
          "Set it to an empty PostgreSQL test database, e.g. postgresql://postgres:test@127.0.0.1:5433/atom_test"
      );
    }

    assertSafeTestDatabaseUrl(databaseUrl);

    pool = new PostgresAdapter(databaseUrl);
    setPool(pool);
    await runMigrations(MIGRATIONS_DIR);
  }, 30000);

  afterEach(async () => {
    if (!pool) {
      throw new Error("Integration test pool was not initialized");
    }

    await pool.query("DELETE FROM tree_nodes");
    await pool.query("DELETE FROM cards");
    await pool.query("DELETE FROM agents");
    await pool.query("DELETE FROM users");
  });

  afterAll(async () => {
    await closePool();
    pool = null;
  }, 10000);
}
