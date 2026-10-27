import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { closeDb, getDb, runMigrations, setDb } from "../../src/db/client.js";
import { PostgresAdapter } from "../../src/db/adapters/postgres.js";
import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import { insertCard } from "../../src/db/queries/cards.js";
import { insertNode } from "../../src/db/queries/tree.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS_DIR = path.join(root, "src/db/migrations-sqlite");
const POSTGRES_MIGRATIONS_DIR = path.join(root, "src/db/migrations");
const MIGRATION_FILE = "015_repair_symlink_children.sql";

describe.each(["sqlite", "postgres"] as const)("U3 symlink child migration on %s", (kind) => {
  let tempDir: string;
  let priorMigrationsDir: string;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "atom-u3-migration-"));
    if (kind === "sqlite") {
      priorMigrationsDir = path.join(tempDir, "prior-migrations");
      fs.mkdirSync(priorMigrationsDir);
      for (const file of fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql") && name !== MIGRATION_FILE)) {
        fs.copyFileSync(path.join(MIGRATIONS_DIR, file), path.join(priorMigrationsDir, file));
      }
      setDb(new SqliteAdapter(":memory:"));
      await runMigrations(priorMigrationsDir);
    } else {
      const databaseUrl = process.env["TEST_DATABASE_URL"];
      if (!databaseUrl || !databaseUrl.includes("atom_test")) {
        throw new Error("U3 migration PostgreSQL test requires the disposable atom_test TEST_DATABASE_URL");
      }
      setDb(new PostgresAdapter(databaseUrl));
      await runMigrations(POSTGRES_MIGRATIONS_DIR);
    }
    expect((await getDb().query("SELECT COUNT(*) AS n FROM cards")).rows[0].n.toString()).toBe("0");
  });

  afterEach(async () => {
    await getDb().query("DELETE FROM tree_nodes");
    await getDb().query("DELETE FROM cards");
  });

  afterAll(async () => {
    await closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("repairs only safe hidden children, preserves descendants, orders siblings, and is idempotent", async () => {
    const db = getDb();
    const canonicalCard = await insertCard(db, { card_type: "structure", title: "Canonical" });
    const canonical = await insertNode(db, canonicalCard.id, null, undefined, false);
    const alias = await insertNode(db, canonicalCard.id, null, undefined, true);

    const riskCard = await insertCard(db, { card_type: "knowledge", title: "Cycle risk" });
    const risk = await insertNode(db, riskCard.id, alias.id, 0, false);
    await db.query("UPDATE tree_nodes SET parent_node_id = $1 WHERE id = $2", [risk.id, canonical.id]);

    const existingOneCard = await insertCard(db, { card_type: "knowledge", title: "Existing one" });
    const existingOne = await insertNode(db, existingOneCard.id, canonical.id, 100, false);
    const existingTwoCard = await insertCard(db, { card_type: "knowledge", title: "Existing two" });
    const existingTwo = await insertNode(db, existingTwoCard.id, canonical.id, 200, false);
    const hiddenOneCard = await insertCard(db, { card_type: "knowledge", title: "Hidden one" });
    const hiddenOne = await insertNode(db, hiddenOneCard.id, alias.id, 100, false);
    const hiddenTwoCard = await insertCard(db, { card_type: "knowledge", title: "Hidden two" });
    const hiddenTwo = await insertNode(db, hiddenTwoCard.id, alias.id, 100, false);
    const nestedCard = await insertCard(db, { card_type: "knowledge", title: "Nested under hidden one" });
    const nested = await insertNode(db, nestedCard.id, hiddenOne.id, undefined, false);

    await db.query("UPDATE tree_nodes SET created_at = $1 WHERE id = $2", ["2021-02-01T00:00:00.000Z", hiddenOne.id]);
    await db.query("UPDATE tree_nodes SET created_at = $1 WHERE id = $2", ["2021-01-01T00:00:00.000Z", hiddenTwo.id]);

    await runMigrations(kind === "sqlite" ? MIGRATIONS_DIR : POSTGRES_MIGRATIONS_DIR);

    const repaired = await db.query(
      "SELECT id, parent_node_id, position FROM tree_nodes WHERE id IN ($1, $2, $3, $4, $5, $6)",
      [risk.id, canonical.id, existingOne.id, existingTwo.id, hiddenOne.id, hiddenTwo.id]
    );
    const byId = new Map(repaired.rows.map((row) => [row.id as string, row]));
    expect(byId.get(risk.id)?.parent_node_id).toBe(alias.id);
    expect(byId.get(hiddenOne.id)?.parent_node_id).toBe(canonical.id);
    expect(byId.get(hiddenTwo.id)?.parent_node_id).toBe(canonical.id);
    expect((await db.query("SELECT parent_node_id FROM tree_nodes WHERE id = $1", [nested.id])).rows[0].parent_node_id)
      .toBe(hiddenOne.id);

    const ordered = await db.query(
      "SELECT id, position FROM tree_nodes WHERE parent_node_id = $1 ORDER BY position ASC, id ASC",
      [canonical.id]
    );
    expect(ordered.rows.map((row) => row.id)).toEqual([
      existingOne.id,
      existingTwo.id,
      hiddenTwo.id,
      hiddenOne.id,
    ]);
    expect(ordered.rows.map((row) => row.position)).toEqual([
      "0000000100",
      "0000000200",
      "0000000300",
      "0000000400",
    ]);

    const firstSnapshot = await db.query("SELECT id, parent_node_id, position FROM tree_nodes ORDER BY id");
    if (kind === "sqlite") {
      const replayDir = path.join(tempDir, "migration-replay");
      fs.mkdirSync(replayDir);
      fs.copyFileSync(
        path.join(MIGRATIONS_DIR, MIGRATION_FILE),
        path.join(replayDir, "999_replay_015_repair_symlink_children.sql")
      );
      await runMigrations(replayDir);
    } else {
      await runMigrations(POSTGRES_MIGRATIONS_DIR);
    }
    const secondSnapshot = await db.query("SELECT id, parent_node_id, position FROM tree_nodes ORDER BY id");
    expect(secondSnapshot.rows).toEqual(firstSnapshot.rows);
  });
});
