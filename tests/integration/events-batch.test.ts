/**
 * Integration tests for atom Event Bus batch:completed patch cases.
 *
 * Requires TEST_DATABASE_URL to point to a running PostgreSQL test instance.
 */

import * as cardService from "../../src/services/card.service.js";
import * as treeService from "../../src/services/tree.service.js";
import * as batchService from "../../src/services/batch.service.js";
import type { BatchNodeUpdateItem } from "../../src/shared/types.js";
import { setupIntegrationTestDb } from "./integration-harness.js";
import { nextAtomEvent } from "./events-fixtures.js";

setupIntegrationTestDb();

describe("Event Bus — batch:completed patch cases", () => {
  it("executeBatchOp emits batch:completed with normalized patches", async () => {
    const eventPromise = nextAtomEvent();
    const result = await batchService.executeBatchOp({
      creates: [{
        temp_id: "created-1",
        card_type: "knowledge",
        title: "Batch Patch Card",
      }],
    });
    const event = await eventPromise;

    expect(event.type).toBe("batch:completed");
    if (event.type === "batch:completed") {
      expect(event.result.created).toEqual(result.created);
      expect(event.patches).toHaveLength(1);
      const [patch] = event.patches;
      expect(patch.type).toBe("card:created");
      if (patch.type === "card:created") {
        expect(patch.cardId).toBe(result.created[0].card_id);
        expect(patch.nodeId).toBe(result.created[0].node_id);
        expect(patch.node.id).toBe(result.created[0].node_id);
        expect(patch.node.card.title).toBe("Batch Patch Card");
      }
    }
  });

  it("executeBatchOp card:updated patches preserve input order and shape", async () => {
    const { card: first } = await cardService.createCard({
      card_type: "knowledge",
      title: "First patch target",
    });
    const { card: second } = await cardService.createCard({
      card_type: "knowledge",
      title: "Second patch target",
    });

    const eventPromise = nextAtomEvent();
    const result = await batchService.executeBatchOp("test-agent", {
      updates: [
        { card_id: second.id, title: "Second patched" },
        { card_id: first.id, title: "First patched" },
      ],
    });
    const event = await eventPromise;

    expect(result.updated).toEqual([second.id, first.id]);
    expect(event.type).toBe("batch:completed");
    if (event.type === "batch:completed") {
      expect(event.result.updated).toEqual([second.id, first.id]);
      expect(event.patches.map((patch) => patch.type)).toEqual([
        "card:updated",
        "card:updated",
      ]);

      const [secondPatch, firstPatch] = event.patches;
      expect(secondPatch.type).toBe("card:updated");
      if (secondPatch.type === "card:updated") {
        expect(secondPatch.cardId).toBe(second.id);
        expect(secondPatch.data.title).toBe("Second patched");
        expect(secondPatch.actor).toBe("test-agent");
      }

      expect(firstPatch.type).toBe("card:updated");
      if (firstPatch.type === "card:updated") {
        expect(firstPatch.cardId).toBe(first.id);
        expect(firstPatch.data.title).toBe("First patched");
        expect(firstPatch.actor).toBe("test-agent");
      }
    }
  });

  it("executeBatchOp appends update patches after symlinks and before node_updates", async () => {
    const { card: symlinkSource } = await cardService.createCard({
      card_type: "knowledge",
      title: "Patch order symlink source",
    });
    const { card: updateTarget } = await cardService.createCard({
      card_type: "knowledge",
      title: "Patch order update target",
    });
    const { node_id: nodeUpdateTargetId } = await cardService.createCard({
      card_type: "structure",
      title: "Patch order node update target",
    });

    const eventPromise = nextAtomEvent();
    await batchService.executeBatchOp({
      creates: [
        {
          temp_id: "parent",
          card_type: "structure",
          title: "Patch order parent",
        },
      ],
      symlinks: [{ card_id: symlinkSource.id, parent_temp_id: "parent" }],
      updates: [{ card_id: updateTarget.id, title: "Patch order updated" }],
      node_updates: [{ node_id: nodeUpdateTargetId, journal_limit: 9 }],
    });
    const event = await eventPromise;

    expect(event.type).toBe("batch:completed");
    if (event.type === "batch:completed") {
      expect(event.patches.map((patch) => patch.type)).toEqual([
        "card:created",
        "node:created",
        "card:updated",
        "node:updated",
      ]);
      const updatePatch = event.patches[2];
      expect(updatePatch.type).toBe("card:updated");
      if (updatePatch.type === "card:updated") {
        expect(updatePatch.cardId).toBe(updateTarget.id);
        expect(updatePatch.data.title).toBe("Patch order updated");
      }
    }
  });

  it("executeBatchOp card:deleted patch uses pre-delete node ids and parents", async () => {
    const { card, node_id: canonicalNodeId } = await cardService.createCard({
      card_type: "knowledge",
      title: "Batch deleted patch target",
    });
    const { node_id: symlinkParentNodeId } = await cardService.createCard({
      card_type: "structure",
      title: "Batch deleted patch symlink parent",
    });
    const symlinkNode = await treeService.createSymlink(
      card.id,
      symlinkParentNodeId
    );
    const nodesBeforeDelete = await cardService.getCardNodes(card.id);

    expect(nodesBeforeDelete.map((node) => node.id)).toEqual([
      canonicalNodeId,
      symlinkNode.id,
    ]);

    const eventPromise = nextAtomEvent();
    const result = await batchService.executeBatchOp({
      deletes: [{ card_id: card.id }],
    });
    const event = await eventPromise;

    expect(result.deleted).toEqual([card.id]);
    expect(await cardService.getCardNodes(card.id)).toHaveLength(0);

    expect(event.type).toBe("batch:completed");
    if (event.type === "batch:completed") {
      expect(event.result.deleted).toEqual([card.id]);
      expect(event.patches).toHaveLength(1);
      const [patch] = event.patches;
      expect(patch.type).toBe("card:deleted");
      if (patch.type === "card:deleted") {
        expect(patch.cardId).toBe(card.id);
        expect(patch.nodeIds).toEqual(
          nodesBeforeDelete.map((node) => node.id)
        );
        expect(patch.parentNodeIds).toEqual(
          nodesBeforeDelete.map((node) => node.parent_node_id)
        );
        expect(patch.actor).toBeNull();
      }
    }
  });

  it("executeBatchOp appends delete patches after child_order patches", async () => {
    const { card: deleteTarget } = await cardService.createCard({
      card_type: "knowledge",
      title: "Batch patch order delete target",
    });
    const { node_id: parentNodeId } = await cardService.createCard({
      card_type: "structure",
      title: "Batch patch order parent",
    });
    const { node_id: firstChildNodeId } = await cardService.createCard({
      card_type: "knowledge",
      title: "Batch patch order first child",
      parent_node_id: parentNodeId,
    });
    const { node_id: secondChildNodeId } = await cardService.createCard({
      card_type: "knowledge",
      title: "Batch patch order second child",
      parent_node_id: parentNodeId,
    });

    const eventPromise = nextAtomEvent();
    await batchService.executeBatchOp({
      child_orders: [
        {
          parent_node_id: parentNodeId,
          order: [secondChildNodeId, firstChildNodeId],
        },
      ],
      deletes: [{ card_id: deleteTarget.id }],
    });
    const event = await eventPromise;

    expect(event.type).toBe("batch:completed");
    if (event.type === "batch:completed") {
      expect(event.patches.map((patch) => patch.type)).toEqual([
        "node:moved",
        "node:moved",
        "card:deleted",
      ]);
      const deletePatch = event.patches[2];
      expect(deletePatch.type).toBe("card:deleted");
      if (deletePatch.type === "card:deleted") {
        expect(deletePatch.cardId).toBe(deleteTarget.id);
      }
    }
  });

  it("executeBatchOp preserves create and symlink result and patch order", async () => {
    const { card: sourceA } = await cardService.createCard({
      card_type: "knowledge",
      title: "Patch symlink source A",
    });
    const { card: sourceB } = await cardService.createCard({
      card_type: "knowledge",
      title: "Patch symlink source B",
    });

    const eventPromise = nextAtomEvent();
    const result = await batchService.executeBatchOp({
      creates: [
        {
          temp_id: "child",
          parent_temp_id: "parent",
          card_type: "knowledge",
          title: "Patch Child",
        },
        {
          temp_id: "parent",
          card_type: "structure",
          title: "Patch Parent",
        },
      ],
      symlinks: [
        { card_id: sourceA.id, parent_temp_id: "parent" },
        { card_id: sourceB.id, parent_temp_id: "child" },
      ],
    });
    const event = await eventPromise;

    expect(result.created.map((item) => item.temp_id)).toEqual([
      "parent",
      "child",
    ]);
    expect(result.symlinked).toHaveLength(2);

    expect(event.type).toBe("batch:completed");
    if (event.type === "batch:completed") {
      expect(event.result.created).toEqual(result.created);
      expect(event.result.symlinked).toEqual(result.symlinked);
      expect(event.patches.map((patch) => patch.type)).toEqual([
        "card:created",
        "card:created",
        "node:created",
        "node:created",
      ]);

      const [parentPatch, childPatch, symlinkAPatch, symlinkBPatch] = event.patches;
      const parentNodeId = result.created[0].node_id;
      const childNodeId = result.created[1].node_id;

      expect(parentPatch.type).toBe("card:created");
      if (parentPatch.type === "card:created") {
        expect(parentPatch.nodeId).toBe(parentNodeId);
        expect(parentPatch.parentNodeId).toBeNull();
        expect(parentPatch.node.card.title).toBe("Patch Parent");
      }

      expect(childPatch.type).toBe("card:created");
      if (childPatch.type === "card:created") {
        expect(childPatch.nodeId).toBe(childNodeId);
        expect(childPatch.parentNodeId).toBe(parentNodeId);
        expect(childPatch.node.parent_node_id).toBe(parentNodeId);
        expect(childPatch.node.card.title).toBe("Patch Child");
      }

      expect(symlinkAPatch.type).toBe("node:created");
      if (symlinkAPatch.type === "node:created") {
        expect(symlinkAPatch.nodeId).toBe(result.symlinked[0]);
        expect(symlinkAPatch.cardId).toBe(sourceA.id);
        expect(symlinkAPatch.parentNodeId).toBe(parentNodeId);
        expect(symlinkAPatch.node.is_symlink).toBe(true);
      }

      expect(symlinkBPatch.type).toBe("node:created");
      if (symlinkBPatch.type === "node:created") {
        expect(symlinkBPatch.nodeId).toBe(result.symlinked[1]);
        expect(symlinkBPatch.cardId).toBe(sourceB.id);
        expect(symlinkBPatch.parentNodeId).toBe(childNodeId);
        expect(symlinkBPatch.node.is_symlink).toBe(true);
      }
    }
  });

  it("executeBatchOp node_updates patches only actual updates", async () => {
    const { node_id: updatedNodeId } = await cardService.createCard({
      card_type: "structure",
      title: "Batch patch updated",
    });
    const { node_id: noopNodeId } = await cardService.createCard({
      card_type: "structure",
      title: "Batch patch noop",
    });

    const eventPromise = nextAtomEvent();
    const result = await batchService.executeBatchOp({
      node_updates: [
        { node_id: updatedNodeId, journal_limit: 4 },
        { node_id: noopNodeId } as unknown as BatchNodeUpdateItem,
      ],
    });
    const event = await eventPromise;

    expect(result.node_updated).toEqual([updatedNodeId]);
    expect(event.type).toBe("batch:completed");
    if (event.type === "batch:completed") {
      const nodeUpdatedPatches = event.patches.filter(
        (patch) => patch.type === "node:updated"
      );
      expect(nodeUpdatedPatches).toHaveLength(1);
      const [patch] = nodeUpdatedPatches;
      expect(patch.nodeId).toBe(updatedNodeId);
      expect(patch.node.journal_limit).toBe(4);
    }
  });
});
