import path from "path";
import { fileURLToPath } from "url";

import { closeDb, getDb, runMigrations, setDb } from "../../src/db/client.js";
import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import { insertCard } from "../../src/db/queries/cards.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations-sqlite");

beforeEach(async () => {
  setDb(new SqliteAdapter(":memory:"));
  await runMigrations(MIGRATIONS_DIR);
});

afterEach(async () => {
  await closeDb();
});

describe("insertCard on SQLite", () => {
  it("applies the full schema without retired card fields", async () => {
    const names = (await getDb().query(`SELECT name FROM pragma_table_info('cards')`)).rows
      .map((row) => row["name"] as string);

    expect(names).not.toEqual(expect.arrayContaining([
      "stale" + "ness",
      "source_" + "checksum",
      "source_" + "checked_at",
    ]));
    expect(names).toContain("source_snapshot");
  });

  it("stores the actor as both creator and updater", async () => {
    const card = await insertCard(
      getDb(),
      { card_type: "knowledge", title: "SQLite card" },
      "agent-123"
    );

    expect(card.created_by).toBe("agent-123");
    expect(card.updated_by).toBe("agent-123");
  });

  it("stores null creator and updater when no actor is provided", async () => {
    const card = await insertCard(getDb(), {
      card_type: "knowledge",
      title: "SQLite card without actor",
    });

    expect(card.created_by).toBeNull();
    expect(card.updated_by).toBeNull();
  });
});
