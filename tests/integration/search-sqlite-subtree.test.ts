import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, getDb, runMigrations, setDb } from "../../src/db/client.js";
import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import { insertCard } from "../../src/db/queries/cards.js";
import { searchByBm25 } from "../../src/db/queries/search.js";
import { insertNode } from "../../src/db/queries/tree.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrations = path.join(root, "src/db/migrations-sqlite");

describe("SQLite BM25 subtree search", () => {
  beforeEach(async () => {
    setDb(new SqliteAdapter(":memory:"));
    await runMigrations(migrations);
  });

  afterEach(async () => {
    await closeDb();
  });

  it("returns matching cards only from the requested subtree", async () => {
    const db = getDb();
    const rootCard = await insertCard(db, {
      card_type: "structure",
      title: "Search scope",
      content: "Container for scoped results",
    });
    const rootNode = await insertNode(db, rootCard.id, null, 1);

    const inScope = await insertCard(db, {
      card_type: "knowledge",
      title: "In scope",
      content: "sharedneedle appears here",
    });
    await insertNode(db, inScope.id, rootNode.id, 1);

    const outOfScope = await insertCard(db, {
      card_type: "knowledge",
      title: "Out of scope",
      content: "sharedneedle appears here too",
    });
    await insertNode(db, outOfScope.id, null, 2);

    const results = await searchByBm25(db, {
      query: "sharedneedle",
      root_node_id: rootNode.id,
    });

    expect(results.map(result => result.card_id)).toEqual([inScope.id]);
  });
});
