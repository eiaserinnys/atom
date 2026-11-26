import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import { closeDb, getDb, runMigrations, setDb } from "../../src/db/client.js";
import { insertCard, selectCardById, updateCardById } from "../../src/db/queries/cards.js";
import { searchByBm25 } from "../../src/db/queries/search.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations-sqlite");

beforeEach(async () => {
  setDb(new SqliteAdapter(":memory:"));
  await runMigrations(MIGRATIONS_DIR);
});

afterEach(async () => {
  await closeDb();
});

async function foundTitles(query: string): Promise<string[]> {
  const results = await searchByBm25(getDb(), { query });
  return results.map((result) => result.title);
}

async function create(title: string, content?: string | null) {
  return insertCard(getDb(), { card_type: "knowledge", title, content });
}

describe("SQLite card updates keep the full-text index in step", () => {
  it.each([
    ["without content", undefined],
    ["with null content", null],
    ["with empty content", ""],
  ])("indexes content added to a card created %s", async (_label, initial) => {
    const card = await create("Empty at first", initial);

    await updateCardById(getDb(), card.id, { content: "pomegranate notes" }, true);

    expect((await selectCardById(getDb(), card.id))?.content).toBe("pomegranate notes");
    expect(await foundTitles("pomegranate")).toEqual(["Empty at first"]);
  });

  it("replaces the indexed content when it changes", async () => {
    const card = await create("Changing", "apricot");

    await updateCardById(getDb(), card.id, { content: "quince" }, true);

    expect(await foundTitles("apricot")).toEqual([]);
    expect(await foundTitles("quince")).toEqual(["Changing"]);
  });

  it("reindexes a title-only edit without losing the content", async () => {
    const card = await create("Old title", "mulberry");

    await updateCardById(getDb(), card.id, { title: "Renamed" }, false);

    expect(await foundTitles("Renamed")).toEqual(["Renamed"]);
    expect(await foundTitles("mulberry")).toEqual(["Renamed"]);
    expect(await foundTitles("Old")).toEqual([]);
  });

  it("drops a card from the index when its content is cleared", async () => {
    const card = await create("Clearing", "persimmon");

    await updateCardById(getDb(), card.id, { content: "" }, true);

    expect(await foundTitles("persimmon")).toEqual([]);
    expect(await foundTitles("Clearing")).toEqual(["Clearing"]);
  });

  it("still stamps updated_at on updates that do not set it", async () => {
    const card = await create("Stamped", "kumquat");
    await getDb().query(`UPDATE cards SET updated_at = '2000-01-01 00:00:00' WHERE id = $1`, [card.id]);

    await updateCardById(getDb(), card.id, { content: "loquat" }, true);

    const stored = await selectCardById(getDb(), card.id);
    expect(stored?.updated_at).not.toBe("2000-01-01 00:00:00");
  });
});

describe("migration 017 on a database installed before it", () => {
  it("replaces the update trigger and keeps what was already indexed", async () => {
    const oldMigrations = fs.mkdtempSync(path.join(os.tmpdir(), "atom-migrations-016-"));
    try {
      for (const file of fs.readdirSync(MIGRATIONS_DIR).filter((name) => name < "017")) {
        fs.copyFileSync(path.join(MIGRATIONS_DIR, file), path.join(oldMigrations, file));
      }
      await closeDb();
      setDb(new SqliteAdapter(":memory:"));
      await runMigrations(oldMigrations);
      const empty = await create("Installed empty");
      await create("Installed full", "damson");

      await runMigrations(MIGRATIONS_DIR);

      const trigger = await getDb().query(`SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'cards_fts_update'`);
      expect(trigger.rows[0]?.["sql"]).toContain("AFTER UPDATE OF title, content, tags ON cards");
      await updateCardById(getDb(), empty.id, { content: "greengage" }, true);
      expect(await foundTitles("greengage")).toEqual(["Installed empty"]);
      expect(await foundTitles("damson")).toEqual(["Installed full"]);
    } finally {
      fs.rmSync(oldMigrations, { recursive: true, force: true });
    }
  });
});
