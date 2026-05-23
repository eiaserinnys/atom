/**
 * Integration tests for move_node relative position API.
 *
 * Requires TEST_DATABASE_URL pointing to a test PostgreSQL instance.
 */

import { executeBatchOp } from "../../src/services/batch.service.js";
import * as cardService from "../../src/services/card.service.js";
import * as treeService from "../../src/services/tree.service.js";
import { selectChildren } from "../../src/db/queries/tree.js";
import {
  createParentWithChildren,
  setupRelativePositionIntegrationTest,
} from "./relative-position-fixtures.js";

const getPool = setupRelativePositionIntegrationTest();

describe("move_node — relative positioning", () => {
  it("before: places node before a sibling", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(3);
    const [a, b, c] = childNodeIds;

    const { node: moved } = await treeService.moveNode(c, {
      parent_node_id: parentNodeId,
      before: a,
    });
    expect(moved).not.toBeNull();

    const children = await selectChildren(getPool(), parentNodeId);
    expect(children.map((n) => n.id)).toEqual([c, a, b]);
  });

  it("after: places node after a sibling", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(3);
    const [a, b, c] = childNodeIds;

    const { node: moved } = await treeService.moveNode(a, {
      parent_node_id: parentNodeId,
      after: b,
    });
    expect(moved).not.toBeNull();

    const children = await selectChildren(getPool(), parentNodeId);
    expect(children.map((n) => n.id)).toEqual([b, a, c]);
  });

  it("to='start': places node as first child", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(3);
    const [a, b, c] = childNodeIds;

    const { node: moved } = await treeService.moveNode(c, {
      parent_node_id: parentNodeId,
      to: "start",
    });
    expect(moved).not.toBeNull();

    const children = await selectChildren(getPool(), parentNodeId);
    expect(children.map((n) => n.id)).toEqual([c, a, b]);
  });

  it("to='end': places node as last child", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(3);
    const [a, b, c] = childNodeIds;

    const { node: moved } = await treeService.moveNode(a, {
      parent_node_id: parentNodeId,
      to: "end",
    });
    expect(moved).not.toBeNull();

    const children = await selectChildren(getPool(), parentNodeId);
    expect(children.map((n) => n.id)).toEqual([b, c, a]);
  });

  it("before self: keeps the existing sibling order", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(3);
    const [a, b, c] = childNodeIds;

    const { node: moved } = await treeService.moveNode(b, {
      parent_node_id: parentNodeId,
      before: b,
    });
    expect(moved).not.toBeNull();

    const children = await selectChildren(getPool(), parentNodeId);
    expect(children.map((n) => n.id)).toEqual([a, b, c]);
    expect(children.find((n) => n.id === b)!.position).toBe(moved!.position);
  });

  it("before self: sole child keeps its existing non-default position", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(1, 250);
    const [only] = childNodeIds;

    const beforeMove = await selectChildren(getPool(), parentNodeId);
    expect(beforeMove.map((n) => n.id)).toEqual([only]);
    expect(beforeMove[0].position).toBe(250);

    const { node: moved } = await treeService.moveNode(only, {
      parent_node_id: parentNodeId,
      before: only,
    });
    expect(moved).not.toBeNull();

    const children = await selectChildren(getPool(), parentNodeId);
    expect(children.map((n) => n.id)).toEqual([only]);
    expect(moved!.position).toBe(250);
    expect(children[0].position).toBe(250);
  });

  it("after self: keeps the existing sibling order", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(3);
    const [a, b, c] = childNodeIds;

    const { node: moved } = await treeService.moveNode(b, {
      parent_node_id: parentNodeId,
      after: b,
    });
    expect(moved).not.toBeNull();

    const children = await selectChildren(getPool(), parentNodeId);
    expect(children.map((n) => n.id)).toEqual([a, b, c]);
    expect(children.find((n) => n.id === b)!.position).toBe(moved!.position);
  });

  it("after self: sole child keeps its existing non-default position", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(1, 250);
    const [only] = childNodeIds;

    const beforeMove = await selectChildren(getPool(), parentNodeId);
    expect(beforeMove.map((n) => n.id)).toEqual([only]);
    expect(beforeMove[0].position).toBe(250);

    const { node: moved } = await treeService.moveNode(only, {
      parent_node_id: parentNodeId,
      after: only,
    });
    expect(moved).not.toBeNull();

    const children = await selectChildren(getPool(), parentNodeId);
    expect(children.map((n) => n.id)).toEqual([only]);
    expect(moved!.position).toBe(250);
    expect(children[0].position).toBe(250);
  });

  it("before first child with position 0: triggers rekey", async () => {
    const parentResult = await executeBatchOp({
      creates: [
        { temp_id: "p", card_type: "structure", title: "Parent" },
        {
          temp_id: "first",
          card_type: "knowledge",
          title: "First",
          parent_temp_id: "p",
          position: 0,
        },
      ],
    });
    const parentNodeId = parentResult.created.find((c) => c.temp_id === "p")!.node_id;
    const firstNodeId = parentResult.created.find((c) => c.temp_id === "first")!.node_id;

    const { node_id: moverNodeId } = await cardService.createCard({
      card_type: "knowledge",
      title: "Mover",
      parent_node_id: parentNodeId,
    });

    const { node: moved } = await treeService.moveNode(moverNodeId, {
      parent_node_id: parentNodeId,
      to: "start",
    });
    expect(moved).not.toBeNull();

    const children = await selectChildren(getPool(), parentNodeId);
    expect(children[0].id).toBe(moverNodeId);
    expect(children.some((child) => child.id === firstNodeId)).toBe(true);
    for (const child of children) {
      expect(Number.isInteger(child.position)).toBe(true);
      expect(child.position).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("move_node — parent keep-current (f995e015 fix)", () => {
  it("omit parent_node_id: keeps current parent (not root)", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(3);
    const [a, b, c] = childNodeIds;

    const { node: moved } = await treeService.moveNode(a, { to: "end" });
    expect(moved).not.toBeNull();
    expect(moved!.parent_node_id).toBe(parentNodeId);

    const children = await selectChildren(getPool(), parentNodeId);
    expect(children.map((n) => n.id)).toEqual([b, c, a]);
  });

  it("f995e015 scenario 1: batch_op moves position-only reorder keeps parent", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(2);
    const [a] = childNodeIds;

    await executeBatchOp({
      moves: [{ node_id: a, new_position: 300 }],
    });

    const children = await selectChildren(getPool(), parentNodeId);
    expect(children.some((n) => n.id === a)).toBe(true);
    const aNode = children.find((n) => n.id === a)!;
    expect(aNode.parent_node_id).toBe(parentNodeId);
  });

  it("f995e015 scenario 2: batch_op moves 23 nodes position-only keeps parent", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(5);

    await executeBatchOp({
      moves: childNodeIds.map((nodeId, i) => ({
        node_id: nodeId,
        new_position: (5 - i) * 100,
      })),
    });

    const children = await selectChildren(getPool(), parentNodeId);
    expect(children).toHaveLength(5);
    for (const child of children) {
      expect(child.parent_node_id).toBe(parentNodeId);
    }
    expect(children.map((n) => n.id)).toEqual([...childNodeIds].reverse());
  });

  it("parent_node_id = null: explicitly moves to root", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(1);
    const [a] = childNodeIds;

    const { node: moved } = await treeService.moveNode(a, {
      parent_node_id: null,
    });
    expect(moved).not.toBeNull();
    expect(moved!.parent_node_id).toBeNull();

    const children = await selectChildren(getPool(), parentNodeId);
    expect(children).toHaveLength(0);
  });
});

describe("move_node — deprecated position", () => {
  it("position works but returns _warnings", async () => {
    const { parentNodeId, childNodeIds } = await createParentWithChildren(2);
    const [a] = childNodeIds;

    const { node: moved, warnings } = await treeService.moveNode(a, {
      parent_node_id: parentNodeId,
      position: 50,
    });
    expect(moved).not.toBeNull();
    expect(moved!.position).toBe(50);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("deprecated");
  });
});

describe("move_node — mutual exclusivity", () => {
  it("before + after: throws", async () => {
    const { childNodeIds } = await createParentWithChildren(2);
    const [a, b] = childNodeIds;

    await expect(treeService.moveNode(a, { before: b, after: b })).rejects.toThrow(
      /only one of/
    );
  });

  it("before + position: throws", async () => {
    const { childNodeIds } = await createParentWithChildren(2);
    const [a, b] = childNodeIds;

    await expect(treeService.moveNode(a, { before: b, position: 100 })).rejects.toThrow(
      /only one of/
    );
  });

  it("to + after: throws", async () => {
    const { childNodeIds } = await createParentWithChildren(2);
    const [a, b] = childNodeIds;

    await expect(treeService.moveNode(a, { to: "start", after: b })).rejects.toThrow(
      /only one of/
    );
  });
});

describe("move_node — error cases", () => {
  it("before non-existent sibling: throws", async () => {
    const { childNodeIds } = await createParentWithChildren(1);
    const [a] = childNodeIds;

    await expect(
      treeService.moveNode(a, { before: "00000000-0000-0000-0000-000000000000" })
    ).rejects.toThrow(/not found among siblings/);
  });
});
