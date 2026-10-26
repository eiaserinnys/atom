import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import { closeDb, getDb, runMigrations, setDb } from "../../src/db/client.js";
import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import { insertAgent } from "../../src/db/queries/agents.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations-sqlite");
const MIGRATION_FILE = "014_agent_scope.sql";
let priorMigrationsDir: string;

afterEach(async () => {
  await closeDb();
  if (priorMigrationsDir) fs.rmSync(priorMigrationsDir, { recursive: true, force: true });
});

describe("migration 014 on SQLite", () => {
  it("applies on a fresh database and defaults new agents to write", async () => {
    setDb(new SqliteAdapter(":memory:"));
    await runMigrations(MIGRATIONS_DIR);

    const columns = await getDb().query("SELECT name FROM pragma_table_info('agents')");
    expect(columns.rows.map((row) => row["name"])).toContain("scope");

    const agent = await insertAgent(getDb(), {
      agent_id: "sqlite-default-scope",
      secret_hash: "hash",
    });
    expect(agent.scope).toBe("write");
    await expect(getDb().query("UPDATE agents SET scope = 'admin' WHERE id = $1", [agent.id]))
      .rejects.toThrow();
  });

  it("keeps existing agents at write and records migration 014 once", async () => {
    priorMigrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), "atom-migrations-014-prior-"));
    for (const file of fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql") && name !== MIGRATION_FILE)) {
      fs.copyFileSync(path.join(MIGRATIONS_DIR, file), path.join(priorMigrationsDir, file));
    }

    setDb(new SqliteAdapter(":memory:"));
    await runMigrations(priorMigrationsDir);
    await getDb().query(
      "INSERT INTO agents (id, agent_id, secret_hash) VALUES ($1, $2, $3)",
      ["legacy-agent", "legacy-agent", "hash"],
    );

    await runMigrations(MIGRATIONS_DIR);
    await runMigrations(MIGRATIONS_DIR);

    const result = await getDb().query("SELECT scope FROM agents WHERE id = $1", ["legacy-agent"]);
    expect(result.rows).toEqual([{ scope: "write" }]);
    const recorded = await getDb().query("SELECT name FROM schema_migrations WHERE name = $1", [MIGRATION_FILE]);
    expect(recorded.rows).toEqual([{ name: MIGRATION_FILE }]);
  });
});
