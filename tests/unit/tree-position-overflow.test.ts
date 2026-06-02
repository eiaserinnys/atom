import type { QueryResult } from "pg";
import type { Queryable } from "../../src/db/queryable.js";
import { insertNode } from "../../src/db/queries/tree.js";
import { resolvePositionKey } from "../../src/services/tree-position.service.js";

type FakeNodeRow = {
  id: string;
  card_id: string;
  parent_node_id: string | null;
  position: string;
  is_symlink: boolean;
  created_at: string;
  journal_limit: number | null;
};

class FakeTreeDb implements Queryable {
  insertedKey: string | null = null;

  constructor(private rows: FakeNodeRow[]) {}

  async query<T extends Record<string, unknown> = any>(
    sql: string,
    values: unknown[] = []
  ): Promise<QueryResult<T>> {
    if (sql.includes("SELECT COALESCE(MAX(position)") || sql.includes("SELECT MAX(position)")) {
      const excludedId = values.length > 1 ? values[1] : null;
      const candidates = this.rows.filter((row) => row.id !== excludedId);
      const max_pos = candidates.length
        ? candidates.map((row) => row.position).sort().at(-1)!
        : sql.includes("COALESCE")
          ? "0000000000"
          : null;
      return result([{ max_pos }] as unknown as T[]);
    }

    if (sql.includes("SELECT id, position FROM tree_nodes")) {
      const excludedId = values.length > 1 ? values[1] : null;
      const rows = this.rows
        .filter((row) => row.id !== excludedId)
        .sort(compareRowOrder)
        .map((row) => ({ id: row.id, position: row.position }));
      return result(rows as unknown as T[]);
    }

    if (sql.includes("SELECT * FROM tree_nodes")) {
      return result([...this.rows].sort(compareRowOrder) as unknown as T[]);
    }

    if (sql.includes("UPDATE tree_nodes SET position = $1 WHERE id = $2")) {
      const [position, id] = values as [string, string];
      const row = this.rows.find((candidate) => candidate.id === id);
      if (row) row.position = position;
      return result([] as T[], row ? 1 : 0);
    }

    if (sql.includes("INSERT INTO tree_nodes")) {
      const [id, cardId, parentNodeId, position, isSymlink] = values as [
        string,
        string,
        string | null,
        string,
        boolean,
      ];
      const row: FakeNodeRow = {
        id,
        card_id: cardId,
        parent_node_id: parentNodeId,
        position,
        is_symlink: isSymlink,
        created_at: "2026-06-02T00:00:00.000Z",
        journal_limit: null,
      };
      this.rows.push(row);
      this.insertedKey = position;
      return result([row] as unknown as T[]);
    }

    throw new Error(`Unhandled fake query: ${sql}`);
  }
}

function result<T extends Record<string, unknown>>(
  rows: T[],
  rowCount = rows.length
): QueryResult<T> {
  return {
    rows,
    rowCount,
    command: "",
    oid: 0,
    fields: [],
  };
}

function compareRowOrder(a: FakeNodeRow, b: FakeNodeRow): number {
  if (a.position < b.position) return -1;
  if (a.position > b.position) return 1;
  return a.id.localeCompare(b.id);
}

function node(id: string, position: string): FakeNodeRow {
  return {
    id,
    card_id: `card-${id}`,
    parent_node_id: "parent",
    position,
    is_symlink: false,
    created_at: "2026-06-02T00:00:00.000Z",
    journal_limit: null,
  };
}

describe("tree position overflow fallback", () => {
  it("adds a new child under a parent whose max stored key exceeds INT32_MAX", async () => {
    const db = new FakeTreeDb([
      node("existing", "0000000100"),
      node("overflow", "2147483648"),
    ]);

    const inserted = await insertNode(db, "new-card", "parent", undefined);

    expect(inserted.id).toBeTruthy();
    expect(db.insertedKey).not.toBeNull();
    expect(db.insertedKey! > "2147483648").toBe(true);
  });

  it("moves a sibling to end under a parent whose max stored key exceeds INT32_MAX", async () => {
    const db = new FakeTreeDb([
      node("first", "0000000100"),
      node("overflow", "2147483648"),
    ]);

    const resolved = await resolvePositionKey(db, "parent", "first", { to: "end" });

    expect(resolved.key > "2147483648").toBe(true);
  });

  it("reorders siblings around overflow keys in the same parent", async () => {
    const db = new FakeTreeDb([
      node("first", "0000000100"),
      node("overflow-a", "2147483648"),
      node("overflow-b", "2147483748"),
    ]);

    const resolved = await resolvePositionKey(db, "parent", "first", {
      after: "overflow-a",
    });

    expect(resolved.key > "2147483648").toBe(true);
    expect(resolved.key < "2147483748").toBe(true);
  });

  it("keeps the empty-parent first child append behavior", async () => {
    const db = new FakeTreeDb([]);

    const inserted = await insertNode(db, "new-card", "parent", undefined);

    expect(inserted.position).toBe(100);
    expect(db.insertedKey).toBe("0000000100");
  });
});
