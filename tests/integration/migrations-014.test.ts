import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { getIntegrationTestPool, setupIntegrationTestDb } from "./integration-harness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = path.resolve(__dirname, "../../src/db/migrations/014_agent_scope.sql");
setupIntegrationTestDb();

describe("migration 014 on PostgreSQL", () => {
  it("adds the write default to existing rows and survives repeated execution", async () => {
    const db = getIntegrationTestPool();
    await db.query("ALTER TABLE agents DROP COLUMN scope");
    await db.query(
      `INSERT INTO agents (id, agent_id, secret_hash)
       VALUES ('11111111-1111-4111-8111-111111111111', 'legacy-agent-014', 'hash')`,
    );

    const migration = fs.readFileSync(MIGRATION_FILE, "utf-8");
    await db.query(migration);
    await db.query(migration);

    const result = await db.query(
      "SELECT scope FROM agents WHERE agent_id = $1",
      ["legacy-agent-014"],
    );
    expect(result.rows).toEqual([{ scope: "write" }]);
    await expect(db.query(
      "UPDATE agents SET scope = 'admin' WHERE agent_id = $1",
      ["legacy-agent-014"],
    )).rejects.toThrow();
  });
});
