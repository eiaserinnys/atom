import { executeBatchOp } from "../../src/services/batch.service.js";
import { selectChildren } from "../../src/db/queries/tree.js";
import * as cardService from "../../src/services/card.service.js";
import { getIntegrationTestPool, setupIntegrationTestDb } from "./integration-harness.js";

setupIntegrationTestDb();

describe("executeBatchOp — moves", () => {
  it("moves a node to a new parent", async () => {
    const { card: parentCard, node_id: parentNodeId } = await cardService.createCard({
      card_type: "structure",
      title: "Parent",
    });
    const { card: childCard, node_id: childNodeId } = await cardService.createCard({
      card_type: "knowledge",
      title: "Child",
    });

    await executeBatchOp({
      moves: [
        {
          node_id: childNodeId,
          new_parent_node_id: parentNodeId,
        },
      ],
    });

    const nodeRow = await getIntegrationTestPool().query(
      "SELECT parent_node_id FROM tree_nodes WHERE id = $1",
      [childNodeId]
    );
    expect(nodeRow.rows[0]["parent_node_id"]).toBe(parentNodeId);

    // Avoid unused variable warning
    expect(parentCard.id).toBeTruthy();
    expect(childCard.id).toBeTruthy();
  });

  it("moves a node to a create's node via parent_temp_id", async () => {
    const { card: existingCard, node_id: existingNodeId } =
      await cardService.createCard({
        card_type: "knowledge",
        title: "Node to move",
      });

    const result = await executeBatchOp({
      creates: [
        { temp_id: "newParent", card_type: "structure", title: "New Parent" },
      ],
      moves: [
        {
          node_id: existingNodeId,
          parent_temp_id: "newParent",
        },
      ],
    });

    const newParentNodeId = result.created.find(
      (c) => c.temp_id === "newParent"
    )!.node_id;

    const nodeRow = await getIntegrationTestPool().query(
      "SELECT parent_node_id FROM tree_nodes WHERE id = $1",
      [existingNodeId]
    );
    expect(nodeRow.rows[0]["parent_node_id"]).toBe(newParentNodeId);
    expect(existingCard.id).toBeTruthy();
  });
});

describe("executeBatchOp — same-parent reorder moves", () => {
  it("reorders children under the same parent without position conflict", async () => {
    // Create parent + 3 children
    const createResult = await executeBatchOp({
      creates: [
        { temp_id: "parent", card_type: "structure", title: "Parent" },
        {
          temp_id: "a",
          card_type: "knowledge",
          title: "Child A",
          parent_temp_id: "parent",
          position: 100,
        },
        {
          temp_id: "b",
          card_type: "knowledge",
          title: "Child B",
          parent_temp_id: "parent",
          position: 200,
        },
        {
          temp_id: "c",
          card_type: "knowledge",
          title: "Child C",
          parent_temp_id: "parent",
          position: 300,
        },
      ],
    });

    const parentNodeId = createResult.created.find(
      (c) => c.temp_id === "parent"
    )!.node_id;
    const aNodeId = createResult.created.find(
      (c) => c.temp_id === "a"
    )!.node_id;
    const bNodeId = createResult.created.find(
      (c) => c.temp_id === "b"
    )!.node_id;
    const cNodeId = createResult.created.find(
      (c) => c.temp_id === "c"
    )!.node_id;

    // Reorder: B(100), C(200), A(300) — positions overlap with originals
    await executeBatchOp({
      moves: [
        { node_id: bNodeId, new_parent_node_id: parentNodeId, new_position: 100 },
        { node_id: cNodeId, new_parent_node_id: parentNodeId, new_position: 200 },
        { node_id: aNodeId, new_parent_node_id: parentNodeId, new_position: 300 },
      ],
    });

    // Verify final order — selectChildren funnels through rowToNode which
    // converts the TEXT position to number, so legacy integer assertions
    // (e.g. toBe(300)) keep working with the cycle A1 schema.
    const children = await selectChildren(getIntegrationTestPool(), parentNodeId);
    expect(children.map((c) => c.id)).toEqual([bNodeId, cNodeId, aNodeId]);
  });

  it("reorders 10+ children under the same parent", async () => {
    // Create parent
    const parentResult = await executeBatchOp({
      creates: [
        { temp_id: "parent", card_type: "structure", title: "Big Parent" },
      ],
    });
    const parentNodeId = parentResult.created[0].node_id;

    // Create 12 children
    const childCreates = Array.from({ length: 12 }, (_, i) => ({
      temp_id: `child${i}`,
      card_type: "knowledge" as const,
      title: `Child ${i}`,
      parent_node_id: parentNodeId,
      position: (i + 1) * 100,
    }));
    const childResult = await executeBatchOp({ creates: childCreates });
    const childNodeIds = childResult.created.map((c) => c.node_id);

    // Reverse the order: child11 first, child0 last
    const reversedMoves = childNodeIds.map((nodeId, i) => ({
      node_id: nodeId,
      new_parent_node_id: parentNodeId,
      new_position: (childNodeIds.length - i) * 100,
    }));

    await executeBatchOp({ moves: reversedMoves });

    // Verify reversed order
    const children = await selectChildren(getIntegrationTestPool(), parentNodeId);
    const actualOrder = children.map((c) => c.id);
    expect(actualOrder).toEqual([...childNodeIds].reverse());
  });

  it("handles mixed same-parent and cross-parent moves", async () => {
    const createResult = await executeBatchOp({
      creates: [
        { temp_id: "p1", card_type: "structure", title: "Parent 1" },
        { temp_id: "p2", card_type: "structure", title: "Parent 2" },
        {
          temp_id: "a",
          card_type: "knowledge",
          title: "A",
          parent_temp_id: "p1",
          position: 100,
        },
        {
          temp_id: "b",
          card_type: "knowledge",
          title: "B",
          parent_temp_id: "p1",
          position: 200,
        },
        {
          temp_id: "c",
          card_type: "knowledge",
          title: "C",
          parent_temp_id: "p2",
          position: 100,
        },
      ],
    });

    const p1NodeId = createResult.created.find(
      (c) => c.temp_id === "p1"
    )!.node_id;
    const aNodeId = createResult.created.find(
      (c) => c.temp_id === "a"
    )!.node_id;
    const bNodeId = createResult.created.find(
      (c) => c.temp_id === "b"
    )!.node_id;
    const cNodeId = createResult.created.find(
      (c) => c.temp_id === "c"
    )!.node_id;

    // Swap A and B under p1, move C to p1
    await executeBatchOp({
      moves: [
        { node_id: bNodeId, new_parent_node_id: p1NodeId, new_position: 100 },
        { node_id: aNodeId, new_parent_node_id: p1NodeId, new_position: 200 },
        { node_id: cNodeId, new_parent_node_id: p1NodeId, new_position: 300 },
      ],
    });

    const children = await selectChildren(getIntegrationTestPool(), p1NodeId);
    expect(children.map((c) => c.id)).toEqual([bNodeId, aNodeId, cNodeId]);
  });

  it("explicit position collisions share keys deterministically (cycle A2)", async () => {
    // Cycle A2 semantic change: park-and-assign is gone. When a caller
    // moves nodes to positions that overlap with existing siblings, the
    // keys are simply *shared* — non-conflict-avoidance is now the
    // contract of the absolute-position API. Ordering remains
    // deterministic via the (position, id) tie-break.
    //
    // Callers needing automatic collision avoidance will use cycle B's
    // `before/after` MCP interface (see analysis cache §2.1).
    //
    // Setup: A(100), B(200), C(300), D(400) under parent.
    // Move A→300 and B→400. Expected post-move: A & C share key 300,
    // B & D share key 400. All four nodes remain. Order is
    // [min-id@300, max-id@300, min-id@400, max-id@400].
    const createResult = await executeBatchOp({
      creates: [
        { temp_id: "parent", card_type: "structure", title: "Parent" },
        {
          temp_id: "a",
          card_type: "knowledge",
          title: "A",
          parent_temp_id: "parent",
          position: 100,
        },
        {
          temp_id: "b",
          card_type: "knowledge",
          title: "B",
          parent_temp_id: "parent",
          position: 200,
        },
        {
          temp_id: "c",
          card_type: "knowledge",
          title: "C",
          parent_temp_id: "parent",
          position: 300,
        },
        {
          temp_id: "d",
          card_type: "knowledge",
          title: "D",
          parent_temp_id: "parent",
          position: 400,
        },
      ],
    });

    const parentNodeId = createResult.created.find(
      (c) => c.temp_id === "parent"
    )!.node_id;
    const aNodeId = createResult.created.find(
      (c) => c.temp_id === "a"
    )!.node_id;
    const bNodeId = createResult.created.find(
      (c) => c.temp_id === "b"
    )!.node_id;
    const cNodeId = createResult.created.find(
      (c) => c.temp_id === "c"
    )!.node_id;
    const dNodeId = createResult.created.find(
      (c) => c.temp_id === "d"
    )!.node_id;

    await executeBatchOp({
      moves: [
        { node_id: aNodeId, new_parent_node_id: parentNodeId, new_position: 300 },
        { node_id: bNodeId, new_parent_node_id: parentNodeId, new_position: 400 },
      ],
    });

    const children = await selectChildren(getIntegrationTestPool(), parentNodeId);
    expect(children).toHaveLength(4);

    // Positions sorted ascending: two 300s then two 400s.
    const positions = children.map((c) => c.position);
    expect(positions).toEqual([300, 300, 400, 400]);

    // Within each shared-position group, id ASC tie-break makes order
    // deterministic. Compare to a sorted view that uses the same key.
    const ids = children.map((c) => c.id);
    const expectedIds = [...children]
      .sort((x, y) => x.position - y.position || x.id.localeCompare(y.id))
      .map((c) => c.id);
    expect(ids).toEqual(expectedIds);

    // All four originals survive; A & B sit at their requested positions.
    expect(new Set(ids)).toEqual(
      new Set([aNodeId, bNodeId, cNodeId, dNodeId])
    );
    const aPos = children.find((c) => c.id === aNodeId)!.position;
    const bPos = children.find((c) => c.id === bNodeId)!.position;
    expect(aPos).toBe(300);
    expect(bPos).toBe(400);
    // C and D keep their original positions — park-and-assign no
    // longer relocates them.
    const cPos = children.find((c) => c.id === cNodeId)!.position;
    const dPos = children.find((c) => c.id === dNodeId)!.position;
    expect(cPos).toBe(300);
    expect(dPos).toBe(400);
  });

  it("reorders with undefined positions (append-to-end)", async () => {
    const createResult = await executeBatchOp({
      creates: [
        { temp_id: "parent", card_type: "structure", title: "Parent" },
        {
          temp_id: "a",
          card_type: "knowledge",
          title: "A",
          parent_temp_id: "parent",
          position: 100,
        },
        {
          temp_id: "b",
          card_type: "knowledge",
          title: "B",
          parent_temp_id: "parent",
          position: 200,
        },
      ],
    });

    const parentNodeId = createResult.created.find(
      (c) => c.temp_id === "parent"
    )!.node_id;
    const aNodeId = createResult.created.find(
      (c) => c.temp_id === "a"
    )!.node_id;
    const bNodeId = createResult.created.find(
      (c) => c.temp_id === "b"
    )!.node_id;

    // Move both without specifying position — both append to end
    await executeBatchOp({
      moves: [
        { node_id: aNodeId, new_parent_node_id: parentNodeId },
        { node_id: bNodeId, new_parent_node_id: parentNodeId },
      ],
    });

    // Both should still be under parent, positions should be distinct
    const children = await selectChildren(getIntegrationTestPool(), parentNodeId);
    expect(children).toHaveLength(2);
    const positions = children.map((c) => c.position);
    expect(new Set(positions).size).toBe(2); // distinct positions
  });
});
