import path from "node:path";
import { fileURLToPath } from "node:url";

import { closeDb, runMigrations, setDb } from "../../src/db/client.js";
import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import { defineTreeParentScenarios } from "./tree-parent-scenarios.js";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src/db/migrations-sqlite"
);

beforeEach(async () => {
  setDb(new SqliteAdapter(":memory:"));
  await runMigrations(MIGRATIONS_DIR);
});

afterEach(async () => {
  await closeDb();
});

defineTreeParentScenarios();
