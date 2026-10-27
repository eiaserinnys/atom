import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getIntegrationTestPool, setupIntegrationTestDb } from "./integration-harness.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATION_FILE = path.join(
  root,
  "src/db/migrations/016_rekey_duplicate_positions.sql",
);

setupIntegrationTestDb();

describe("U4 migration 016 on PostgreSQL", () => {
  it("rekeys every child in duplicate parents by position, created_at, and id, then changes zero rows", async () => {
    const db = getIntegrationTestPool();

    async function insertNode(
      parentNodeId: string | null,
      position: string,
      createdAt: string,
      title: string,
    ): Promise<string> {
      const cardId = crypto.randomUUID();
      const nodeId = crypto.randomUUID();
      await db.query(
        "INSERT INTO cards (id, card_type, title) VALUES ($1, 'knowledge', $2)",
        [cardId, title],
      );
      await db.query(
        "INSERT INTO tree_nodes (id, card_id, parent_node_id, position, created_at) VALUES ($1, $2, $3, $4, $5)",
        [nodeId, cardId, parentNodeId, position, createdAt],
      );
      return nodeId;
    }

    const parentId = await insertNode(
      null,
      "0000000100",
      "2026-10-28T00:00:00.000Z",
      "U4 migration parent",
    );
    const beforeId = await insertNode(
      parentId,
      "0000000100",
      "2026-10-28T00:00:00.000Z",
      "U4 before",
    );
    const lateId = await insertNode(
      parentId,
      "0000000200",
      "2026-10-28T00:00:03.000Z",
      "U4 duplicate late",
    );
    const earlyId = await insertNode(
      parentId,
      "0000000200",
      "2026-10-28T00:00:01.000Z",
      "U4 duplicate early",
    );
    const middleId = await insertNode(
      parentId,
      "0000000200",
      "2026-10-28T00:00:02.000Z",
      "U4 duplicate middle",
    );
    const afterId = await insertNode(
      parentId,
      "0000000300",
      "2026-10-28T00:00:04.000Z",
      "U4 after",
    );

    const migration = fs.readFileSync(MIGRATION_FILE, "utf8");
    const firstResult = await db.query(migration);
    const firstCommand = Array.isArray(firstResult)
      ? firstResult.at(-1)
      : firstResult;
    const rows = await db.query(
      "SELECT id, position FROM tree_nodes WHERE parent_node_id = $1 ORDER BY position ASC, id ASC",
      [parentId],
    );

    expect(firstCommand?.rowCount).toBe(3);
    expect(rows.rows.map((row) => row["id"])).toEqual([
      beforeId,
      earlyId,
      middleId,
      lateId,
      afterId,
    ]);
    expect(rows.rows.map((row) => row["position"])).toEqual([
      "0000000100",
      "0000000200",
      "0000000300",
      "0000000400",
      "0000000500",
    ]);
    for (let i = 1; i < rows.rows.length; i++) {
      expect(String(rows.rows[i - 1]!["position"]) < String(rows.rows[i]!["position"])).toBe(true);
    }

    const secondResult = await db.query(migration);
    const secondCommand = Array.isArray(secondResult)
      ? secondResult.at(-1)
      : secondResult;
    expect(secondCommand?.rowCount).toBe(0);
  });
});
