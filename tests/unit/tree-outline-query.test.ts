/**
 * Outline query — the card body is only read when an excerpt is requested.
 *
 * A capturing Queryable records the SQL; no database is involved.
 */
import { selectTreeOutlineRows } from "../../src/db/queries/tree-outline.js";
import type { Queryable } from "../../src/db/queryable.js";

function capturingDb() {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const db: Queryable = {
    query: (async (sql: string, params?: unknown[]) => {
      statements.push({ sql, params: params ?? [] });
      return { rows: [], rowCount: 0, command: "", oid: 0, fields: [] };
    }) as Queryable["query"],
  };
  return { db, statements };
}

describe("selectTreeOutlineRows body access", () => {
  it("does not select card content without an excerpt", async () => {
    const { db, statements } = capturingDb();
    await selectTreeOutlineRows(db, null, 2, 0);
    expect(statements).toHaveLength(1);
    expect(statements[0]!.sql).not.toMatch(/content/i);
  });

  it("selects a bounded content prefix for level-1 rows only when an excerpt is requested", async () => {
    const { db, statements } = capturingDb();
    await selectTreeOutlineRows(db, "0b6a3b3c-5d7e-4f10-9a2b-3c4d5e6f7a8b", 2, 4000);
    expect(statements).toHaveLength(1);
    expect(statements[0]!.sql).toMatch(/CASE WHEN o\.level = 1 THEN SUBSTR\(c\.content, 1, 4000\) END/);
    expect(statements[0]!.sql.match(/content/g)).toHaveLength(2); // c.content + its alias only
    // The prefix length is inlined, so the placeholder list is unchanged.
    expect(statements[0]!.params).toEqual(["0b6a3b3c-5d7e-4f10-9a2b-3c4d5e6f7a8b", 2]);
  });

  it.each([-1, 1.5, Number.NaN])("refuses a non-integer or negative prefix length %p", async (chars) => {
    const { db } = capturingDb();
    await expect(selectTreeOutlineRows(db, null, 2, chars)).rejects.toThrow(/content prefix/);
  });
});
