import path from "path";
import { fileURLToPath } from "url";

import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import { closeDb, setDb } from "../../src/db/client.js";
import { defineDeletionScenarios } from "../integration/deletion-scenarios.js";

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/db/migrations-sqlite");

beforeEach(async () => {
  const db = new SqliteAdapter(":memory:");
  setDb(db);
  await db.runMigrations(MIGRATIONS_DIR);
});

afterEach(async () => {
  await closeDb();
});

defineDeletionScenarios();
