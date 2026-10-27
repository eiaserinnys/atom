import { moveNode } from "../../src/services/tree.service.js";
import { executeBatchOp } from "../../src/services/batch.service.js";
import { createCard } from "../../src/services/card.service.js";
import { assertTreeParent, selectNodeById } from "../../src/db/queries/tree.js";
import { getDb } from "../../src/db/client.js";
import { setupIntegrationTestDb } from "./integration-harness.js";

setupIntegrationTestDb();

async function createOppositeMoveFixture(iteration: number): Promise<{ a: string; b: string }> {
  const a = await createCard({ card_type: "structure", title: "A " + iteration });
  const b = await createCard({ card_type: "structure", title: "B " + iteration });
  return { a: a.node_id, b: b.node_id };
}

async function expectOneMoveToFailWithCycle(a: string, b: string, moves: Promise<unknown>[]): Promise<void> {
  const results = await Promise.allSettled(moves);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const rejection = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  expect(rejection?.reason).toMatchObject({ code: "TREE_CYCLE", statusCode: 400 });

  const rows = await getDb().query(
    "SELECT id, parent_node_id FROM tree_nodes WHERE id IN ($1, $2) ORDER BY id",
    [a, b]
  );
  expect(rows.rows).toHaveLength(2);
  const roots = await getDb().query(
    "SELECT id FROM tree_nodes WHERE id IN ($1, $2) AND parent_node_id IS NULL",
    [a, b]
  );
  expect(roots.rows).toHaveLength(1);
  for (const row of rows.rows) {
    const node = await selectNodeById(getDb(), row.id as string);
    await expect(assertTreeParent(getDb(), row.id as string, node?.parent_node_id ?? null)).resolves.toBeUndefined();
  }
}

async function clearFixture(): Promise<void> {
  await getDb().query("DELETE FROM tree_nodes");
  await getDb().query("DELETE FROM cards");
}

describe("U3 PostgreSQL tree move serialization", () => {
  it("serializes opposite single moves over 20 fresh root pairs", async () => {
    for (let iteration = 0; iteration < 20; iteration++) {
      await clearFixture();
      const { a, b } = await createOppositeMoveFixture(iteration);
      await expectOneMoveToFailWithCycle(a, b, [
        moveNode(a, { parent_node_id: b }),
        moveNode(b, { parent_node_id: a }),
      ]);
    }
  });

  it("serializes single moves against batch moves over 20 fresh root pairs", async () => {
    for (let iteration = 0; iteration < 20; iteration++) {
      await clearFixture();
      const { a, b } = await createOppositeMoveFixture(iteration);
      await expectOneMoveToFailWithCycle(a, b, [
        moveNode(a, { parent_node_id: b }),
        executeBatchOp({ moves: [{ node_id: b, new_parent_node_id: a }] }),
      ]);
    }
  });

  it("serializes single moves against child_orders reparenting over 20 fresh root pairs", async () => {
    for (let iteration = 0; iteration < 20; iteration++) {
      await clearFixture();
      const { a, b } = await createOppositeMoveFixture(iteration);
      await expectOneMoveToFailWithCycle(a, b, [
        moveNode(a, { parent_node_id: b }),
        executeBatchOp({ child_orders: [{ parent_node_id: a, order: [b] }] }),
      ]);
    }
  });
});
