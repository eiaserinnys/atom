import path from "path";
import { fileURLToPath } from "url";

import { closeDb, getDb, runMigrations, setDb } from "../../src/db/client.js";
import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import { selectNodeById } from "../../src/db/queries/tree.js";
import * as cardService from "../../src/services/card.service.js";
import * as treeService from "../../src/services/tree.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations-sqlite");

beforeEach(async () => {
  setDb(new SqliteAdapter(":memory:"));
  await runMigrations(MIGRATIONS_DIR);
});

afterEach(async () => {
  await closeDb();
});

describe("SQLite boolean bindings", () => {
  it("creates canonical and symlink nodes and binds booleans for updates", async () => {
    const { card, node_id: canonicalNodeId } = await cardService.createCard({
      card_type: "knowledge",
      title: "Boolean binding",
    });

    const canonicalRow = await getDb().query(
      "SELECT is_symlink FROM tree_nodes WHERE id = $1",
      [canonicalNodeId]
    );
    expect(canonicalRow.rows[0]["is_symlink"]).toBe(0);
    expect((await selectNodeById(getDb(), canonicalNodeId))?.is_symlink).toBe(false);

    const symlink = await treeService.createSymlink(card.id, null);
    expect(symlink.is_symlink).toBe(true);
    const symlinkRow = await getDb().query(
      "SELECT is_symlink FROM tree_nodes WHERE id = $1",
      [symlink.id]
    );
    expect(symlinkRow.rows[0]["is_symlink"]).toBe(1);

    await getDb().query(
      "UPDATE tree_nodes SET is_symlink = $1 WHERE id = $2",
      [false, symlink.id]
    );
    expect((await selectNodeById(getDb(), symlink.id))?.is_symlink).toBe(false);
  });
});
