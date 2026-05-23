/**
 * Integration tests for batch_op child_orders and relative move payloads.
 *
 * Requires TEST_DATABASE_URL pointing to a test PostgreSQL instance.
 */

import { executeBatchOp } from "../../src/services/batch.service.js";
import { selectChildren } from "../../src/db/queries/tree.js";
import {
  createParentWithChildren,
  setupRelativePositionIntegrationTest,
} from "./relative-position-fixtures.js";

const getPool = setupRelativePositionIntegrationTest();

describe("batch_op — child_orders", () => {
  it("reorders children", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(4);
    const [a, b, c, d] = childNodeIds;

    await executeBatchOp({
      child_orders: [{ parent_node_id: parentNodeId, order: [d, c, b, a] }],
    });

    const children = await selectChildren(getPool(), parentNodeId);
    expect(children.map((n) => n.id)).toEqual([d, c, b, a]);
  });

  it("cross-parent: re-parents nodes listed in order", async () => {
    const {
      parentNodeId: p1,
      childNodeIds: [a, b],
    } = await createParentWithChildren(2);
    const {
      parentNodeId: p2,
      childNodeIds: [c],
    } = await createParentWithChildren(1);

    await executeBatchOp({
      child_orders: [{ parent_node_id: p1, order: [a, c, b] }],
    });

    const childrenP1 = await selectChildren(getPool(), p1);
    expect(childrenP1.map((n) => n.id)).toEqual([a, c, b]);

    const childrenP2 = await selectChildren(getPool(), p2);
    expect(childrenP2.some((n) => n.id === c)).toBe(false);
  });

  it("child_orders after moves: both applied in sequence", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(3);
    const [a, b, c] = childNodeIds;

    await executeBatchOp({
      moves: [{ node_id: a, new_parent_node_id: parentNodeId, to: "end" }],
      child_orders: [{ parent_node_id: parentNodeId, order: [c, b, a] }],
    });

    const children = await selectChildren(getPool(), parentNodeId);
    expect(children.map((n) => n.id)).toEqual([c, b, a]);
  });

  it("child_orders with non-existent node: throws and rolls back", async () => {
    const { parentNodeId } = await createParentWithChildren(1);

    await expect(
      executeBatchOp({
        child_orders: [
          {
            parent_node_id: parentNodeId,
            order: ["00000000-0000-0000-0000-000000000000"],
          },
        ],
      })
    ).rejects.toThrow(/node not found/);
  });

  it("result includes child_ordered parent IDs", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(2);

    const result = await executeBatchOp({
      child_orders: [{ parent_node_id: parentNodeId, order: [...childNodeIds].reverse() }],
    });

    expect(result.child_ordered).toEqual([parentNodeId]);
  });
});

describe("batch_op — moves with before/after/to", () => {
  it("batch move with before", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(3);
    const [a, b, c] = childNodeIds;

    await executeBatchOp({
      moves: [{ node_id: c, new_parent_node_id: parentNodeId, before: a }],
    });

    const children = await selectChildren(getPool(), parentNodeId);
    expect(children.map((n) => n.id)).toEqual([c, a, b]);
  });

  it("batch move with to='start'", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(3);
    const [, , c] = childNodeIds;

    await executeBatchOp({
      moves: [{ node_id: c, new_parent_node_id: parentNodeId, to: "start" }],
    });

    const children = await selectChildren(getPool(), parentNodeId);
    expect(children[0].id).toBe(c);
  });

  it("batch move with deprecated new_position returns _warnings", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(2);
    const [a] = childNodeIds;

    const result = await executeBatchOp({
      moves: [{ node_id: a, new_parent_node_id: parentNodeId, new_position: 50 }],
    });

    expect(result._warnings).toHaveLength(1);
    expect(result._warnings![0]).toContain("deprecated");
  });
});
