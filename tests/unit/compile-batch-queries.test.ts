import { selectCardsByIds } from "../../src/db/queries/cards.js";
import { selectCanonicalNodesByCardIds, selectChildrenByParentIds } from "../../src/db/queries/tree.js";
import type { Queryable } from "../../src/db/queryable.js";
import { loadTreeCompileContext } from "../../src/services/tree-compile-context.service.js";
import { posToKey } from "../../src/shared/lexorank.js";
import { makeCard, makeNode } from "./bfs-fixtures.js";

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

  it("loads the whole tree when depth is NaN", async () => {
    const cards = ["root", "child", "grandchild", "great-grandchild"].map((id) =>
      makeCard({ id, title: id })
    );
    const nodes = cards.map((card, index) => ({
      ...makeNode({
        id: `node-${card.id}`,
        card_id: card.id,
        parent_node_id: index === 0 ? null : `node-${cards[index - 1].id}`,
      }),
      position: posToKey(100),
    }));
    const db: Queryable = {
      query: (async (sql: string, values: unknown[] = []) => {
        let rows;
        if (sql.includes("WHERE id = $1")) {
          rows = nodes.filter((node) => values.includes(node.id));
        } else if (sql.includes("WHERE parent_node_id IN")) {
          rows = nodes.filter((node) => values.includes(node.parent_node_id));
        } else if (sql.includes("FROM cards")) {
          rows = cards.filter((card) => values.includes(card.id));
        } else {
          throw new Error(`Unexpected query: ${sql}`);
        }
        return { rows, rowCount: rows.length, command: "", oid: 0, fields: [] };
      }) as Queryable["query"],
    };

    const context = await loadTreeCompileContext(db, "node-root", NaN);
    expect(context.getChildren("node-root").map((node) => node.id)).toEqual(["node-child"]);
    expect(context.getChildren("node-child").map((node) => node.id)).toEqual(["node-grandchild"]);
    expect(context.getChildren("node-grandchild").map((node) => node.id)).toEqual(["node-great-grandchild"]);
    expect(context.getCard("great-grandchild").title).toBe("great-grandchild");
  });
});
