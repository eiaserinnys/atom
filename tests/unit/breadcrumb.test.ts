/**
 * Unit tests for getNodeBreadcrumb (tree.ts DB query).
 *
 * Uses an in-memory mock of the Queryable interface to avoid a real DB.
 */

import type { QueryResult, QueryResultRow } from "pg";
import type { Queryable } from "../../src/db/queryable.js";

// We import getNodeBreadcrumb after it's added to tree.ts.
// Until then this import will fail, which is the expected TDD red state.
import { getNodeBreadcrumb } from "../../src/db/queries/tree.js";

function makeMockDb(rows: { title: string }[]): Queryable {
  return {
    query<T extends QueryResultRow = any>(
      _queryText: string,
      _values?: unknown[]
    ): Promise<QueryResult<T>> {
      return Promise.resolve({
        rows: rows as unknown as T[],
        rowCount: rows.length,
        command: "SELECT",
        oid: 0,
        fields: [],
      });
    },
  };
}

describe("getNodeBreadcrumb", () => {
  it("루트 노드: breadcrumb는 해당 노드 제목 1개만 반환한다", async () => {
    const db = makeMockDb([{ title: "Root" }]);
    const result = await getNodeBreadcrumb(db, "node-root");
    expect(result).toEqual(["Root"]);
  });

  it("2단계 깊이 노드: 조상 → 노드 순서로 반환한다", async () => {
    // CTE가 depth DESC로 정렬하므로 조상이 먼저
    const db = makeMockDb([
      { title: "Grandparent" },
      { title: "Parent" },
      { title: "Child" },
    ]);
    const result = await getNodeBreadcrumb(db, "node-child");
    expect(result).toEqual(["Grandparent", "Parent", "Child"]);
  });

  it("존재하지 않는 nodeId: 빈 배열을 반환한다", async () => {
    const db = makeMockDb([]);
    const result = await getNodeBreadcrumb(db, "nonexistent-id");
    expect(result).toEqual([]);
  });
});
