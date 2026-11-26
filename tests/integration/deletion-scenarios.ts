import { getDb } from "../../src/db/client.js";
import { eventBus, type AtomEvent } from "../../src/events/eventBus.js";
import * as cardService from "../../src/services/card.service.js";
import * as treeService from "../../src/services/tree.service.js";
import { executeBatchOp } from "../../src/services/batch.service.js";
import { planTreeDeletion, type TreeDeletionTarget } from "../../src/services/node-deletion.service.js";

async function make(title: string, parentNodeId?: string, cardType: "structure" | "knowledge" = "structure") {
  const created = await cardService.createCard({
    card_type: cardType,
    title,
    parent_node_id: parentNodeId,
  });
  return { cardId: created.card.id, nodeId: created.node_id };
}

async function plan(target: TreeDeletionTarget) {
  const result = await planTreeDeletion(getDb(), target);
  if (!result) throw new Error("plan expected");
  return result;
}

const sorted = (ids: string[]) => [...ids].sort();

async function cardExists(cardId: string): Promise<boolean> {
  return (await cardService.getCard(cardId)) !== null;
}

async function nodeExists(nodeId: string): Promise<boolean> {
  return (await treeService.getNode(nodeId)) !== null;
}

function collectBatchDeletedEvents(): { cardIds: string[]; stop: () => void } {
  const cardIds: string[] = [];
  const handler = (event: AtomEvent) => {
    if (event.type !== "batch:completed") return;
    for (const patch of event.patches) {
      if (patch.type === "card:deleted") cardIds.push(patch.cardId);
    }
  };
  eventBus.on("atom:event", handler);
  return { cardIds, stop: () => eventBus.off("atom:event", handler) };
}

/** The deletion plan and the real deletion agree. The caller wires the database. */
export function defineDeletionScenarios(): void {
  describe("deletion plan matches the real deletion", () => {
    it("a symlink node plans one node and no card, and deleting it keeps the card", async () => {
      const original = await make("Original");
      const other = await make("Other root");
      const alias = await treeService.createSymlink(original.cardId, other.nodeId);

      const planned = await plan({ nodeId: alias.id });
      expect(planned.isCanonicalTarget).toBe(false);
      expect(planned.nodeIds).toEqual([alias.id]);
      expect(planned.deletedCards).toEqual([]);
      expect(await treeService.previewNodeDeletion(alias.id)).toEqual({
        target: "symlink",
        deletedCardIds: [],
        deletedNodeCount: 1,
      });
      expect(await nodeExists(alias.id)).toBe(true);

      expect(await treeService.deleteNode(alias.id)).toEqual({ deletedCardIds: [], deletedNodeCount: 1 });
      expect(await nodeExists(alias.id)).toBe(false);
      expect(await nodeExists(original.nodeId)).toBe(true);
      expect(await cardExists(original.cardId)).toBe(true);
    });

    it("a node with nested descendants plans every node and orphan card, parents first", async () => {
      const top = await make("Top");
      const middle = await make("Middle", top.nodeId);
      const leaf = await make("Leaf", middle.nodeId, "knowledge");

      const preview = await treeService.previewNodeDeletion(top.nodeId);
      expect(preview).toEqual({
        target: "node",
        deletedCardIds: [top.cardId, middle.cardId, leaf.cardId],
        deletedNodeCount: 3,
      });

      const deleted = await treeService.deleteNode(top.nodeId);
      expect(deleted).toEqual({
        deletedCardIds: preview!.deletedCardIds,
        deletedNodeCount: preview!.deletedNodeCount,
      });
      for (const created of [top, middle, leaf]) {
        expect(await cardExists(created.cardId)).toBe(false);
        expect(await nodeExists(created.nodeId)).toBe(false);
      }
    });

    it("a card that also sits elsewhere is not planned and survives", async () => {
      const parent = await make("Parent");
      const shared = await make("Shared", parent.nodeId, "knowledge");
      const elsewhere = await make("Elsewhere");
      const alias = await treeService.createSymlink(shared.cardId, elsewhere.nodeId);

      const preview = await treeService.previewNodeDeletion(parent.nodeId);
      expect(preview).toEqual({
        target: "node",
        deletedCardIds: [parent.cardId],
        deletedNodeCount: 2,
      });

      const planned = await plan({ nodeId: parent.nodeId });
      expect(planned.remainingSymlinks).toEqual([
        { nodeId: alias.id, cardId: shared.cardId, parentNodeId: elsewhere.nodeId },
      ]);

      expect(await treeService.deleteNode(parent.nodeId)).toEqual({
        deletedCardIds: preview!.deletedCardIds,
        deletedNodeCount: preview!.deletedNodeCount,
      });
      expect(await cardExists(shared.cardId)).toBe(true);
      expect(await nodeExists(alias.id)).toBe(true);
      expect(await nodeExists(shared.nodeId)).toBe(false);
    });

    it("a symlink inside the deleted subtree does not keep the card alive", async () => {
      const parent = await make("Parent");
      const child = await make("Child", parent.nodeId, "knowledge");
      const inside = await make("Inside", parent.nodeId);
      await treeService.createSymlink(child.cardId, inside.nodeId);

      const planned = await plan({ nodeId: parent.nodeId });
      expect(planned.remainingSymlinks).toEqual([]);
      expect(sorted(planned.deletedCards.map((card) => card.cardId)))
        .toEqual(sorted([parent.cardId, child.cardId, inside.cardId]));

      const deleted = await treeService.deleteNode(parent.nodeId);
      expect(sorted(deleted!.deletedCardIds)).toEqual(sorted(planned.deletedCards.map((card) => card.cardId)));
      expect(deleted!.deletedNodeCount).toBe(planned.nodeIds.length);
      expect(await cardExists(child.cardId)).toBe(false);
    });

    it("deleting one of several places of a card plans no card, deleting the card plans all places", async () => {
      const first = await make("First root");
      const second = await make("Second root");
      const target = await make("Placed twice", first.nodeId, "knowledge");
      const alias = await treeService.createSymlink(target.cardId, second.nodeId);

      expect(await treeService.previewNodeDeletion(alias.id)).toEqual({
        target: "symlink", deletedCardIds: [], deletedNodeCount: 1,
      });
      expect(await treeService.previewNodeDeletion(target.nodeId)).toEqual({
        target: "node", deletedCardIds: [], deletedNodeCount: 1,
      });

      const preview = await cardService.previewCardDeletion(target.cardId);
      expect(preview).toEqual({ deletedCardIds: [target.cardId], deletedNodeCount: 2 });
      expect(await cardService.deleteCard(target.cardId)).toEqual(preview);
      expect(await nodeExists(alias.id)).toBe(false);
      expect(await nodeExists(target.nodeId)).toBe(false);
    });

    it("delete_card plans the card and the orphan cards below it and previews without deleting", async () => {
      const top = await make("Top");
      const child = await make("Child", top.nodeId, "knowledge");

      const preview = await cardService.previewCardDeletion(top.cardId);
      expect(preview).toEqual({ deletedCardIds: [top.cardId, child.cardId], deletedNodeCount: 2 });
      expect(await cardExists(top.cardId)).toBe(true);
      expect(await nodeExists(child.nodeId)).toBe(true);

      expect(await cardService.deleteCard(top.cardId)).toEqual(preview);
      expect(await cardExists(child.cardId)).toBe(false);
    });

    it("unknown targets plan nothing", async () => {
      const unknown = "00000000-0000-4000-8000-000000000123";
      expect(await treeService.previewNodeDeletion(unknown)).toBeNull();
      expect(await cardService.previewCardDeletion(unknown)).toBeNull();
      expect(await treeService.deleteNode(unknown)).toBeNull();
      expect(await cardService.deleteCard(unknown)).toBeNull();
    });
  });

  describe("batch_op deletes report what was deleted", () => {
    it("rolls back the whole batch when a card did not exist at the start", async () => {
      const kept = await make("Kept by rollback", undefined, "knowledge");
      const missing = "00000000-0000-4000-8000-000000000321";

      await expect(
        executeBatchOp({ deletes: [{ card_id: kept.cardId }, { card_id: missing }] })
      ).rejects.toThrow(`Card not found: ${missing}`);

      expect(await cardExists(kept.cardId)).toBe(true);
      expect(await nodeExists(kept.nodeId)).toBe(true);
    });

    it("skips a card an earlier item already deleted and reports it once", async () => {
      const parent = await make("Batch parent");
      const child = await make("Batch child", parent.nodeId, "knowledge");
      const events = collectBatchDeletedEvents();
      try {
        const result = await executeBatchOp({
          deletes: [{ card_id: parent.cardId }, { card_id: child.cardId }],
        });
        expect(result.deleted).toEqual([parent.cardId, child.cardId]);
        expect(result.cascade_deleted_card_ids).toEqual([]);
        expect(events.cardIds).toEqual([parent.cardId, child.cardId]);
      } finally {
        events.stop();
      }
    });

    it("lists cards that were deleted without being requested apart from the requested ones", async () => {
      const parent = await make("Cascade parent");
      const child = await make("Cascade child", parent.nodeId, "knowledge");
      const events = collectBatchDeletedEvents();
      try {
        const result = await executeBatchOp({ deletes: [{ card_id: parent.cardId }] });
        expect(result.deleted).toEqual([parent.cardId]);
        expect(result.cascade_deleted_card_ids).toEqual([child.cardId]);
        expect(events.cardIds).toEqual([parent.cardId, child.cardId]);
      } finally {
        events.stop();
      }
    });

    it("a card named twice is deleted and reported once", async () => {
      const only = await make("Named twice", undefined, "knowledge");
      const events = collectBatchDeletedEvents();
      try {
        const result = await executeBatchOp({
          deletes: [{ card_id: only.cardId }, { card_id: only.cardId }],
        });
        expect(result.deleted).toEqual([only.cardId]);
        expect(result.cascade_deleted_card_ids).toEqual([]);
        expect(events.cardIds).toEqual([only.cardId]);
      } finally {
        events.stop();
      }
    });

    it("a kept card with a place outside the subtree is neither deleted nor reported", async () => {
      const parent = await make("Keeper parent");
      const shared = await make("Keeper shared", parent.nodeId, "knowledge");
      const elsewhere = await make("Keeper elsewhere");
      await treeService.createSymlink(shared.cardId, elsewhere.nodeId);

      const result = await executeBatchOp({ deletes: [{ card_id: parent.cardId }] });
      expect(result.deleted).toEqual([parent.cardId]);
      expect(result.cascade_deleted_card_ids).toEqual([]);
      expect(await cardExists(shared.cardId)).toBe(true);
    });
  });
}
