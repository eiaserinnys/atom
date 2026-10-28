import { selectCardsByIds } from "../../src/db/queries/cards.js";
import { selectCanonicalNodesByCardIds, selectChildrenByParentIds } from "../../src/db/queries/tree.js";
import type { Queryable } from "../../src/db/queryable.js";

function capturingDb() {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const db: Queryable = {
    query: (async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values: values ?? [] });
      return { rows: [], rowCount: 0, command: "", oid: 0, fields: [] };
    }) as Queryable["query"],
  };
  return { db, statements };
}

const ids = Array.from({ length: 1001 }, (_, index) => `id-${index}`);

describe("compile batch queries", () => {
  it.each([
    ["children", selectChildrenByParentIds],
    ["canonical nodes", selectCanonicalNodesByCardIds],
    ["cards", selectCardsByIds],
  ] as const)("uses PostgreSQL-style placeholders in batches of at most 500 for %s", async (_name, query) => {
    const { db, statements } = capturingDb();
    await query(db, ids);

    expect(statements.map((statement) => statement.values.length)).toEqual([500, 500, 1]);
    expect(statements[0]?.sql).toContain("$1");
    expect(statements[0]?.sql).toContain("$500");
    expect(statements[0]?.sql).not.toMatch(/ANY\s*\(/i);
  });

  it("does not query for an empty ID list", async () => {
    const { db, statements } = capturingDb();
    await selectChildrenByParentIds(db, []);
    await selectCanonicalNodesByCardIds(db, []);
    await selectCardsByIds(db, []);
    expect(statements).toEqual([]);
  });
});
