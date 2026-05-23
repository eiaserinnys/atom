import path from "path";
import { fileURLToPath } from "url";

import { closePool, runMigrations, setPool } from "../../src/db/client.js";
import { PostgresAdapter } from "../../src/db/adapters/postgres.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations");

let pool: PostgresAdapter | null = null;

export function setupIntegrationTestDb(): void {
  beforeAll(async () => {
    const databaseUrl = process.env["TEST_DATABASE_URL"];
    if (!databaseUrl) {
      throw new Error(
        "TEST_DATABASE_URL is required for integration tests.\n" +
          "Set it to the atom-postgres instance: postgresql://atom:atom@localhost:5434/atom_test_db"
      );
    }

    if (!databaseUrl.includes("test")) {
      throw new Error(
        "TEST_DATABASE_URL must point to a test database (URL must contain 'test').\n" +
          "Got: " + databaseUrl
      );
    }

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
