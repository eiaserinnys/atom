import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import { closeDb, getDb, setDb } from "../../src/db/client.js";
import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import { insertNode } from "../../src/db/queries/tree.js";
import * as treeService from "../../src/services/tree.service.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SQLITE_MIGRATIONS_DIR = path.join(root, "src/db/migrations-sqlite");

type PositionRow = { id: string; position: string };

let tempDir: string;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "atom-u4-append-"));
  setDb(new SqliteAdapter(path.join(tempDir, "append.sqlite")));
  await getDb().runMigrations(SQLITE_MIGRATIONS_DIR);
});

afterEach(async () => {
  await getDb().query("DELETE FROM tree_nodes");
  await getDb().query("DELETE FROM cards");
});

afterAll(async () => {
  await closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function createCard(title: string, cardType = "knowledge"): Promise<string> {
  const cardId = crypto.randomUUID();
  await getDb().query(
    "INSERT INTO cards (id, card_type, title) VALUES ($1, $2, $3)",
    [cardId, cardType, title],
  );
  return cardId;
}

async function createNode(
  title: string,
  parentNodeId: string | null,
  position?: number,
  cardType = "knowledge",
) {
  const cardId = await createCard(title, cardType);
  return insertNode(getDb(), cardId, parentNodeId, position);
}

async function childrenByPosition(parentNodeId: string): Promise<PositionRow[]> {
  const result = await getDb().query(
    "SELECT id, position FROM tree_nodes WHERE parent_node_id = $1 ORDER BY position ASC, id ASC",
    [parentNodeId],
  );
  return result.rows.map((row) => ({
    id: String(row["id"]),
    position: String(row["position"]),
  }));
}

function expectNormalStrictlyIncreasing(keys: string[]): void {
  expect(
    keys.every((key) => /^\d{10}$/.test(key) && Number(key) <= 2_147_483_647),
  ).toBe(true);
  for (let i = 1; i < keys.length; i++) {
    expect(keys[i - 1]! < keys[i]!).toBe(true);
  }
}

describe("U4 append key saturation on SQLite", () => {
  it("insertNode appends 100 children in creation order and journal_limit selects the latest N", async () => {
    const parent = await createNode("InsertParent", null, 100, "structure");
    await treeService.updateNodeProperties(parent.id, { journal_limit: 5 });

    const createdIds: string[] = [];
    const titles: string[] = [];
    for (let i = 0; i < 100; i++) {
      const title = "InsertChild-" + String(i).padStart(3, "0");
      titles.push(title);
      const cardId = await createCard(title);
      const child = await insertNode(getDb(), cardId, parent.id, undefined);
      createdIds.push(child.id);
    }

    const rows = await childrenByPosition(parent.id);
    expect(rows.map((row) => row.id)).toEqual(createdIds);
    expectNormalStrictlyIncreasing(rows.map((row) => row.position));

    const listed = await treeService.listChildren(parent.id);
    expect(listed.map((node) => node.id)).toEqual(createdIds);
    expect(listed.at(-1)?.id).toBe(createdIds.at(-1));

    const { markdown } = await treeService.compileSubtree(parent.id, 2);
    for (const title of titles.slice(0, 95)) {
      expect(markdown).not.toContain(title);
    }
    for (const title of titles.slice(95)) {
      expect(markdown).toContain(title);
    }
  });

  it("moveNode default append moves 100 nodes in call order", async () => {
    const parent = await createNode("MoveParent", null, 100, "structure");
    const movedIds: string[] = [];

    for (let i = 0; i < 100; i++) {
      const title = "MoveChild-" + String(i).padStart(3, "0");
      const source = await createNode(title, null, 10_000 + i * 100);
      const moved = await treeService.moveNode(source.id, {
        parent_node_id: parent.id,
      });
      expect(moved.node?.id).toBe(source.id);
      movedIds.push(source.id);
    }

    const rows = await childrenByPosition(parent.id);
    expect(rows.map((row) => row.id)).toEqual(movedIds);
    expectNormalStrictlyIncreasing(rows.map((row) => row.position));

    const listed = await treeService.listChildren(parent.id);
    expect(listed.map((node) => node.id)).toEqual(movedIds);
    expect(listed.at(-1)?.id).toBe(movedIds.at(-1));
  });

  it.each(["insertNode", "moveNode"])(
    "%s rekeys append when the last position is near INT32_MAX",
    async (appendPath) => {
      const parent = await createNode("BoundaryParent-" + appendPath, null, 100, "structure");
      const existing = await createNode(
        "BoundaryExisting-" + appendPath,
        parent.id,
        2_147_483_600,
      );
      let appendedId: string;

      if (appendPath === "insertNode") {
        const cardId = await createCard("BoundaryInserted");
        appendedId = (await insertNode(getDb(), cardId, parent.id, undefined)).id;
      } else {
        const source = await createNode("BoundaryMoved", null, 1_000);
        const moved = await treeService.moveNode(source.id, {
          parent_node_id: parent.id,
        });
        appendedId = moved.node!.id;
      }

      const rows = await childrenByPosition(parent.id);
      expect(rows.map((row) => row.id)).toEqual([existing.id, appendedId]);
      expect(rows.map((row) => row.position)).toEqual(["0000000100", "0000000200"]);
      expectNormalStrictlyIncreasing(rows.map((row) => row.position));
    },
  );
});

describe("U4 migration 016 on SQLite", () => {
  it("rekeys every child in duplicate parents by position, created_at, and id, then changes zero rows", () => {
    const dbPath = path.join(tempDir, "migration-016.sqlite");
    const migrationPath = path.join(
      SQLITE_MIGRATIONS_DIR,
      "016_rekey_duplicate_positions.sql",
    );
    const migration = fs.readFileSync(migrationPath, "utf8");
    const db = new Database(dbPath);

    try {
      db.exec(
        "CREATE TABLE tree_nodes (id TEXT PRIMARY KEY, parent_node_id TEXT, position TEXT NOT NULL, created_at TEXT NOT NULL)",
      );
      const insert = db.prepare(
        "INSERT INTO tree_nodes (id, parent_node_id, position, created_at) VALUES (?, ?, ?, ?)",
      );
      const fixture = [
        ["before", "parent", "0000000100", "2026-10-28T00:00:00.000Z"],
        ["late", "parent", "0000000200", "2026-10-28T00:00:03.000Z"],
        ["early", "parent", "0000000200", "2026-10-28T00:00:01.000Z"],
        ["middle", "parent", "0000000200", "2026-10-28T00:00:02.000Z"],
        ["after", "parent", "0000000300", "2026-10-28T00:00:04.000Z"],
      ];
      for (const row of fixture) insert.run(...row);

      db.exec(migration);
      const firstChanges = (
        db.prepare("SELECT changes() AS changes").get() as { changes: number }
      ).changes;
      const rows = db.prepare(
        "SELECT id, position FROM tree_nodes WHERE parent_node_id = ? ORDER BY position ASC, id ASC",
      ).all("parent") as PositionRow[];

      expect(firstChanges).toBe(3);
      expect(rows.map((row) => row.id)).toEqual([
        "before",
        "early",
        "middle",
        "late",
        "after",
      ]);
      expect(rows.map((row) => row.position)).toEqual([
        "0000000100",
        "0000000200",
        "0000000300",
        "0000000400",
        "0000000500",
      ]);
      expectNormalStrictlyIncreasing(rows.map((row) => row.position));

      db.exec(migration);
      const secondChanges = (
        db.prepare("SELECT changes() AS changes").get() as { changes: number }
      ).changes;
      expect(secondChanges).toBe(0);
    } finally {
      db.close();
    }
  });
});
