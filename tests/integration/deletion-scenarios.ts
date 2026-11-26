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

/** Leaves a symlink-only card, the shape older data has, without going through the delete rule. */
async function dropCanonicalNode(nodeId: string): Promise<void> {
  await getDb().query("DELETE FROM tree_nodes WHERE id = $1", [nodeId]);
}

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
        deletedLinkCount: 0,
      });
      expect(await nodeExists(alias.id)).toBe(true);

      expect(await treeService.deleteNode(alias.id)).toEqual({
        deletedCardIds: [],
        deletedNodeCount: 1,
        deletedLinkCount: 0,
      });
      expect(await nodeExists(alias.id)).toBe(false);
      expect(await nodeExists(original.nodeId)).toBe(true);
      expect(await cardExists(original.cardId)).toBe(true);
    });

    it("the last symlink of a card whose canonical node is gone plans the card and deletes it", async () => {
      const original = await make("Original", undefined, "knowledge");
      const other = await make("Other root");
      const alias = await treeService.createSymlink(original.cardId, other.nodeId);
      await dropCanonicalNode(original.nodeId);
      expect(await cardExists(original.cardId)).toBe(true);

      const planned = await plan({ nodeId: alias.id });
      expect(planned.isCanonicalTarget).toBe(false);
      expect(planned.nodeIds).toEqual([alias.id]);
      expect(planned.deletedCards.map((card) => card.cardId)).toEqual([original.cardId]);
      const preview = await treeService.previewNodeDeletion(alias.id);
      expect(preview).toEqual({
        target: "symlink", deletedCardIds: [original.cardId], deletedNodeCount: 1, deletedLinkCount: 0,
      });
      expect(await cardExists(original.cardId)).toBe(true);

      expect(await treeService.deleteNode(alias.id)).toEqual({
        deletedCardIds: preview!.deletedCardIds,
        deletedNodeCount: preview!.deletedNodeCount,
        deletedLinkCount: preview!.deletedLinkCount,
      });
      expect(await nodeExists(alias.id)).toBe(false);
      expect(await cardExists(original.cardId)).toBe(false);
      expect(await nodeExists(other.nodeId)).toBe(true);
    });

    it("one of two remaining symlinks of a card without a canonical node plans no card and keeps it", async () => {
      const original = await make("Original", undefined, "knowledge");
      const firstRoot = await make("First root");
      const secondRoot = await make("Second root");
      const first = await treeService.createSymlink(original.cardId, firstRoot.nodeId);
      const second = await treeService.createSymlink(original.cardId, secondRoot.nodeId);
      await dropCanonicalNode(original.nodeId);

      const planned = await plan({ nodeId: first.id });
      expect(planned.deletedCards).toEqual([]);
      const preview = await treeService.previewNodeDeletion(first.id);
      expect(preview).toEqual({ target: "symlink", deletedCardIds: [], deletedNodeCount: 1, deletedLinkCount: 0 });

      expect(await treeService.deleteNode(first.id)).toEqual({
        deletedCardIds: [],
        deletedNodeCount: 1,
        deletedLinkCount: 0,
      });
      expect(await nodeExists(first.id)).toBe(false);
      expect(await nodeExists(second.id)).toBe(true);
      expect(await cardExists(original.cardId)).toBe(true);
    });

    it("a symlink with a child card, whose own card keeps another symlink, plans only the child card", async () => {
      const original = await make("Original");
      const firstRoot = await make("First root");
      const secondRoot = await make("Second root");
      const first = await treeService.createSymlink(original.cardId, firstRoot.nodeId);
      const second = await treeService.createSymlink(original.cardId, secondRoot.nodeId);
      await dropCanonicalNode(original.nodeId);
      const child = await make("Child", first.id, "knowledge");

      const planned = await plan({ nodeId: first.id });
      expect(sorted(planned.nodeIds)).toEqual(sorted([first.id, child.nodeId]));
      expect(planned.deletedCards.map((card) => card.cardId)).toEqual([child.cardId]);
      const preview = await treeService.previewNodeDeletion(first.id);
      expect(preview).toEqual({
        target: "symlink", deletedCardIds: [child.cardId], deletedNodeCount: 2, deletedLinkCount: 0,
      });

      expect(await treeService.deleteNode(first.id)).toEqual({
        deletedCardIds: preview!.deletedCardIds,
        deletedNodeCount: preview!.deletedNodeCount,
        deletedLinkCount: preview!.deletedLinkCount,
      });
      expect(await cardExists(child.cardId)).toBe(false);
      expect(await nodeExists(child.nodeId)).toBe(false);
      expect(await cardExists(original.cardId)).toBe(true);
      expect(await nodeExists(second.id)).toBe(true);
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
        deletedLinkCount: 0,
      });

      const deleted = await treeService.deleteNode(top.nodeId);
      expect(deleted).toEqual({
        deletedCardIds: preview!.deletedCardIds,
        deletedNodeCount: preview!.deletedNodeCount,
        deletedLinkCount: preview!.deletedLinkCount,
      });
      for (const created of [top, middle, leaf]) {
        expect(await cardExists(created.cardId)).toBe(false);
        expect(await nodeExists(created.nodeId)).toBe(false);
      }
    });

    it("a canonical node in the subtree takes its other-place symlink and card with it", async () => {
      const parent = await make("Parent");
      const shared = await make("Shared", parent.nodeId, "knowledge");
      const elsewhere = await make("Elsewhere");
      const alias = await treeService.createSymlink(shared.cardId, elsewhere.nodeId);

      const preview = await treeService.previewNodeDeletion(parent.nodeId);
      expect(preview).toEqual({
        target: "node",
        deletedCardIds: [parent.cardId, shared.cardId],
        deletedNodeCount: 3,
        deletedLinkCount: 1,
      });

      const planned = await plan({ nodeId: parent.nodeId });
      expect(sorted(planned.nodeIds)).toEqual(sorted([parent.nodeId, shared.nodeId, alias.id]));
      expect(planned.deletedCards.find((card) => card.cardId === shared.cardId)).toEqual({
        cardId: shared.cardId,
        nodeIds: [shared.nodeId, alias.id],
        parentNodeIds: [parent.nodeId, elsewhere.nodeId],
      });

      expect(await treeService.deleteNode(parent.nodeId)).toEqual({
        deletedCardIds: preview!.deletedCardIds,
        deletedNodeCount: preview!.deletedNodeCount,
        deletedLinkCount: preview!.deletedLinkCount,
      });
      expect(await cardExists(shared.cardId)).toBe(false);
      expect(await nodeExists(alias.id)).toBe(false);
      expect(await nodeExists(shared.nodeId)).toBe(false);
      expect(await cardExists(elsewhere.cardId)).toBe(true);
      expect(await nodeExists(elsewhere.nodeId)).toBe(true);
    });

    it("the picked node's own card takes its other-place symlinks with it", async () => {
      const place = await make("Place");
      const original = await make("Original", place.nodeId, "knowledge");
      const firstRoot = await make("First root");
      const secondRoot = await make("Second root");
      const first = await treeService.createSymlink(original.cardId, firstRoot.nodeId);
      const second = await treeService.createSymlink(original.cardId, secondRoot.nodeId);

      const preview = await treeService.previewNodeDeletion(original.nodeId);
      expect(preview).toEqual({
        target: "node",
        deletedCardIds: [original.cardId],
        deletedNodeCount: 3,
        deletedLinkCount: 2,
      });
      expect(await treeService.deleteNode(original.nodeId)).toEqual({
        deletedCardIds: preview!.deletedCardIds,
        deletedNodeCount: 3,
        deletedLinkCount: 2,
      });
      for (const nodeId of [original.nodeId, first.id, second.id]) expect(await nodeExists(nodeId)).toBe(false);
      expect(await cardExists(original.cardId)).toBe(false);
      expect(await nodeExists(place.nodeId)).toBe(true);
    });

    it("a deep canonical node in the range takes its other-place symlinks with it", async () => {
      const section = await make("Section");
      const middle = await make("Middle", section.nodeId);
      const deep = await make("Deep", middle.nodeId, "knowledge");
      const rootA = await make("Root A");
      const rootB = await make("Root B");
      const linkA = await treeService.createSymlink(deep.cardId, rootA.nodeId);
      const linkB = await treeService.createSymlink(deep.cardId, rootB.nodeId);

      const preview = await treeService.previewNodeDeletion(section.nodeId);
      expect(preview).toEqual({
        target: "node",
        deletedCardIds: [section.cardId, middle.cardId, deep.cardId],
        deletedNodeCount: 5,
        deletedLinkCount: 2,
      });
      expect(await treeService.deleteNode(section.nodeId)).toEqual({
        deletedCardIds: preview!.deletedCardIds,
        deletedNodeCount: 5,
        deletedLinkCount: 2,
      });
      expect(await cardExists(deep.cardId)).toBe(false);
      for (const nodeId of [linkA.id, linkB.id]) expect(await nodeExists(nodeId)).toBe(false);
      expect(await nodeExists(rootA.nodeId)).toBe(true);
    });

    it("a legacy child below an other-place symlink goes too, and its own card is widened", async () => {
      const section = await make("Section");
      const shared = await make("Shared", section.nodeId, "knowledge");
      const elsewhere = await make("Elsewhere");
      const link = await treeService.createSymlink(shared.cardId, elsewhere.nodeId);
      const legacyChild = await make("Legacy child", elsewhere.nodeId, "knowledge");
      const legacyElsewhere = await make("Legacy elsewhere");
      const legacyLink = await treeService.createSymlink(legacyChild.cardId, legacyElsewhere.nodeId);
      await getDb().query("UPDATE tree_nodes SET parent_node_id = $1 WHERE id = $2", [link.id, legacyChild.nodeId]);

      const preview = await treeService.previewNodeDeletion(section.nodeId);
      expect(preview).toEqual({
        target: "node",
        deletedCardIds: [section.cardId, shared.cardId, legacyChild.cardId],
        deletedNodeCount: 5,
        deletedLinkCount: 2,
      });
      expect(await treeService.deleteNode(section.nodeId)).toEqual({
        deletedCardIds: preview!.deletedCardIds,
        deletedNodeCount: 5,
        deletedLinkCount: 2,
      });
      for (const nodeId of [link.id, legacyChild.nodeId, legacyLink.id]) expect(await nodeExists(nodeId)).toBe(false);
      expect(await cardExists(legacyChild.cardId)).toBe(false);
      expect(await nodeExists(elsewhere.nodeId)).toBe(true);
    });

    it("a symlink below another deleted other-place symlink goes with it but is not counted", async () => {
      const section = await make("Section");
      const shared = await make("Shared", section.nodeId, "knowledge");
      const elsewhere = await make("Elsewhere");
      const link = await treeService.createSymlink(shared.cardId, elsewhere.nodeId);
      const keeper = await make("Keeper", undefined, "knowledge");
      const nestedLink = await treeService.createSymlink(keeper.cardId, elsewhere.nodeId);
      await getDb().query("UPDATE tree_nodes SET parent_node_id = $1 WHERE id = $2", [link.id, nestedLink.id]);

      const preview = await treeService.previewNodeDeletion(section.nodeId);
      expect(preview).toEqual({
        target: "node",
        deletedCardIds: [section.cardId, shared.cardId],
        deletedNodeCount: 4,
        deletedLinkCount: 1,
      });
      expect(await treeService.deleteNode(section.nodeId)).toEqual({
        deletedCardIds: preview!.deletedCardIds,
        deletedNodeCount: 4,
        deletedLinkCount: 1,
      });
      for (const nodeId of [link.id, nestedLink.id]) expect(await nodeExists(nodeId)).toBe(false);
      expect(await cardExists(keeper.cardId)).toBe(true);
      expect(await nodeExists(keeper.nodeId)).toBe(true);
      expect(await nodeExists(elsewhere.nodeId)).toBe(true);
    });

    it("a card with two canonical nodes is not widened", async () => {
      const section = await make("Section");
      const odd = await make("Two originals", section.nodeId, "knowledge");
      const other = await make("Other place");
      const secondOriginal = await treeService.createSymlink(odd.cardId, other.nodeId);
      await getDb().query("UPDATE tree_nodes SET is_symlink = FALSE WHERE id = $1", [secondOriginal.id]);
      const third = await make("Third place");
      const alias = await treeService.createSymlink(odd.cardId, third.nodeId);

      const preview = await treeService.previewNodeDeletion(section.nodeId);
      expect(preview).toEqual({
        target: "node",
        deletedCardIds: [section.cardId],
        deletedNodeCount: 2,
        deletedLinkCount: 0,
      });
      await treeService.deleteNode(section.nodeId);
      expect(await cardExists(odd.cardId)).toBe(true);
      expect(await nodeExists(secondOriginal.id)).toBe(true);
      expect(await nodeExists(alias.id)).toBe(true);
    });

    it("a loop between cards still ends: A's canonical holds B's canonical, whose child links back to A", async () => {
      const a = await make("A", undefined, "knowledge");
      const b = await make("B", a.nodeId, "knowledge");
      const aLinkUnderB = await treeService.createSymlink(a.cardId, b.nodeId);
      const bLinkRoot = await make("Holder of B link");
      const bLink = await treeService.createSymlink(b.cardId, bLinkRoot.nodeId);

      const preview = await treeService.previewNodeDeletion(a.nodeId);
      expect(preview).toEqual({
        target: "node",
        deletedCardIds: [a.cardId, b.cardId],
        deletedNodeCount: 4,
        deletedLinkCount: 1,
      });
      expect(await treeService.deleteNode(a.nodeId)).toEqual({
        deletedCardIds: [a.cardId, b.cardId],
        deletedNodeCount: 4,
        deletedLinkCount: 1,
      });
      for (const nodeId of [a.nodeId, b.nodeId, aLinkUnderB.id, bLink.id]) expect(await nodeExists(nodeId)).toBe(false);
      expect(await nodeExists(bLinkRoot.nodeId)).toBe(true);
    });

    it("a symlink inside the deleted subtree does not keep the card alive", async () => {
      const parent = await make("Parent");
      const child = await make("Child", parent.nodeId, "knowledge");
      const inside = await make("Inside", parent.nodeId);
      await treeService.createSymlink(child.cardId, inside.nodeId);

      const planned = await plan({ nodeId: parent.nodeId });
      expect(planned.deletedLinkCount).toBe(0);
      expect(sorted(planned.deletedCards.map((card) => card.cardId)))
        .toEqual(sorted([parent.cardId, child.cardId, inside.cardId]));

      const deleted = await treeService.deleteNode(parent.nodeId);
      expect(sorted(deleted!.deletedCardIds)).toEqual(sorted(planned.deletedCards.map((card) => card.cardId)));
      expect(deleted!.deletedNodeCount).toBe(planned.nodeIds.length);
      expect(await cardExists(child.cardId)).toBe(false);
    });

    it("deleting one symlink place of a card plans no card, deleting its canonical node or the card plans all places", async () => {
      const first = await make("First root");
      const second = await make("Second root");
      const target = await make("Placed twice", first.nodeId, "knowledge");
      const alias = await treeService.createSymlink(target.cardId, second.nodeId);

      expect(await treeService.previewNodeDeletion(alias.id)).toEqual({
        target: "symlink", deletedCardIds: [], deletedNodeCount: 1, deletedLinkCount: 0,
      });
      expect(await treeService.previewNodeDeletion(target.nodeId)).toEqual({
        target: "node", deletedCardIds: [target.cardId], deletedNodeCount: 2, deletedLinkCount: 1,
      });

      const preview = await cardService.previewCardDeletion(target.cardId);
      expect(preview).toEqual({ deletedCardIds: [target.cardId], deletedNodeCount: 2, deletedLinkCount: 0 });
      expect(await cardService.deleteCard(target.cardId)).toEqual(preview);
      expect(await nodeExists(alias.id)).toBe(false);
      expect(await nodeExists(target.nodeId)).toBe(false);
    });

    it("a picked symlink takes the other places of a card whose canonical node sits below it", async () => {
      const original = await make("Original");
      const firstRoot = await make("First root");
      const secondRoot = await make("Second root");
      const first = await treeService.createSymlink(original.cardId, firstRoot.nodeId);
      await treeService.createSymlink(original.cardId, secondRoot.nodeId);
      await dropCanonicalNode(original.nodeId);
      const child = await make("Child", first.id, "knowledge");
      const elsewhere = await make("Elsewhere");
      const childLink = await treeService.createSymlink(child.cardId, elsewhere.nodeId);

      const preview = await treeService.previewNodeDeletion(first.id);
      expect(preview).toEqual({
        target: "symlink",
        deletedCardIds: [child.cardId],
        deletedNodeCount: 3,
        deletedLinkCount: 1,
      });
      expect(await treeService.deleteNode(first.id)).toEqual({
        deletedCardIds: [child.cardId],
        deletedNodeCount: 3,
        deletedLinkCount: 1,
      });
      expect(await nodeExists(childLink.id)).toBe(false);
      expect(await cardExists(original.cardId)).toBe(true);
    });

    it("a node deletion announces the other-place symlink nodes and their parents on card:deleted", async () => {
      const section = await make("Section");
      const shared = await make("Shared", section.nodeId, "knowledge");
      const elsewhere = await make("Elsewhere");
      const alias = await treeService.createSymlink(shared.cardId, elsewhere.nodeId);
      const events: AtomEvent[] = [];
      const handler = (event: AtomEvent) => events.push(event);
      eventBus.on("atom:event", handler);
      try {
        await treeService.deleteNode(section.nodeId);
      } finally {
        eventBus.off("atom:event", handler);
      }
      expect(events.filter((event) => event.type === "card:deleted")).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "card:deleted",
          cardId: shared.cardId,
          nodeIds: [shared.nodeId, alias.id],
          parentNodeIds: [section.nodeId, elsewhere.nodeId],
        }),
      ]));
    });

    it("delete_card plans the card and the orphan cards below it and previews without deleting", async () => {
      const top = await make("Top");
      const child = await make("Child", top.nodeId, "knowledge");

      const preview = await cardService.previewCardDeletion(top.cardId);
      expect(preview).toEqual({ deletedCardIds: [top.cardId, child.cardId], deletedNodeCount: 2, deletedLinkCount: 0 });
      expect(await cardExists(top.cardId)).toBe(true);
      expect(await nodeExists(child.nodeId)).toBe(true);

      expect(await cardService.deleteCard(top.cardId)).toEqual(preview);
      expect(await cardExists(child.cardId)).toBe(false);
    });

    it("lists the places of a card in getCardNodes order, not in id order", async () => {
      const shared = await make("Placed five times", undefined, "knowledge");
      for (let index = 0; index < 4; index += 1) {
        const root = await make(`Place root ${index}`);
        await treeService.createSymlink(shared.cardId, root.nodeId);
      }
      const placesBefore = await cardService.getCardNodes(shared.cardId);
      expect(placesBefore).toHaveLength(5);

      const planned = await plan({ cardId: shared.cardId });
      expect(planned.deletedCards).toEqual([{
        cardId: shared.cardId,
        nodeIds: placesBefore.map((node) => node.id),
        parentNodeIds: placesBefore.map((node) => node.parent_node_id),
      }]);

      const patches: AtomEvent[] = [];
      const handler = (event: AtomEvent) => {
        if (event.type === "batch:completed") patches.push(...event.patches);
      };
      eventBus.on("atom:event", handler);
      try {
        await executeBatchOp({ deletes: [{ card_id: shared.cardId }] });
      } finally {
        eventBus.off("atom:event", handler);
      }
      expect(patches).toEqual([expect.objectContaining({
        type: "card:deleted",
        cardId: shared.cardId,
        nodeIds: placesBefore.map((node) => node.id),
        parentNodeIds: placesBefore.map((node) => node.parent_node_id),
      })]);
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

    it("a card in the range with a symlink elsewhere is deleted with it and reported as a cascade", async () => {
      const parent = await make("Cascade parent");
      const shared = await make("Cascade shared", parent.nodeId, "knowledge");
      const elsewhere = await make("Cascade elsewhere");
      const alias = await treeService.createSymlink(shared.cardId, elsewhere.nodeId);
      const events = collectBatchDeletedEvents();
      try {
        const result = await executeBatchOp({ deletes: [{ card_id: parent.cardId }] });
        expect(result.deleted).toEqual([parent.cardId]);
        expect(result.cascade_deleted_card_ids).toEqual([shared.cardId]);
        expect(events.cardIds).toEqual([parent.cardId, shared.cardId]);
      } finally {
        events.stop();
      }
      expect(await cardExists(shared.cardId)).toBe(false);
      expect(await nodeExists(alias.id)).toBe(false);
      expect(await cardExists(elsewhere.cardId)).toBe(true);
    });

    it("delete_card widens the same way and previews the same", async () => {
      const parent = await make("Card parent");
      const shared = await make("Card shared", parent.nodeId, "knowledge");
      const elsewhere = await make("Card elsewhere");
      const alias = await treeService.createSymlink(shared.cardId, elsewhere.nodeId);

      const preview = await cardService.previewCardDeletion(parent.cardId);
      expect(preview).toEqual({
        deletedCardIds: [parent.cardId, shared.cardId],
        deletedNodeCount: 3,
        deletedLinkCount: 1,
      });
      expect(await cardService.deleteCard(parent.cardId)).toEqual(preview);
      expect(await nodeExists(alias.id)).toBe(false);
      expect(await cardExists(shared.cardId)).toBe(false);
    });
  });
}
