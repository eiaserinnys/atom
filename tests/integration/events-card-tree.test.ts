/**
 * Integration tests for atom Event Bus service emit cases.
 *
 * Requires TEST_DATABASE_URL to point to a running PostgreSQL test instance.
 */

import * as cardService from "../../src/services/card.service.js";
import * as treeService from "../../src/services/tree.service.js";
import { eventBus } from "../../src/events/eventBus.js";
import type { AtomEvent } from "../../src/events/eventBus.js";
import { setupIntegrationTestDb } from "./integration-harness.js";
import { nextAtomEvent } from "./events-fixtures.js";

setupIntegrationTestDb();

describe("Event Bus — emit cases", () => {
  it("createCard emits card:created", async () => {
    const eventPromise = nextAtomEvent();
    const { card, node_id } = await cardService.createCard({
      card_type: "knowledge",
      title: "EventBus Card",
      content: "hello",
    });
    const event = await eventPromise;

    expect(event.type).toBe("card:created");
    if (event.type === "card:created") {
      expect(event.cardId).toBe(card.id);
      expect(event.nodeId).toBe(node_id);
      expect(event.parentNodeId).toBeNull();
      expect(event.data.title).toBe("EventBus Card");
      expect(event.node.id).toBe(node_id);
      expect(event.node.card.id).toBe(card.id);
    }
  });

  it("updateCard emits card:updated", async () => {
    const { card } = await cardService.createCard({
      card_type: "knowledge",
      title: "Before",
    });

    const eventPromise = nextAtomEvent();
    await cardService.updateCard(card.id, { title: "After" });
    const event = await eventPromise;

    expect(event.type).toBe("card:updated");
    if (event.type === "card:updated") {
      expect(event.cardId).toBe(card.id);
      expect(event.data.title).toBe("After");
    }
  });

  it("deleteCard emits card:deleted", async () => {
    const { card } = await cardService.createCard({
      card_type: "knowledge",
      title: "To Delete",
    });

    const eventPromise = nextAtomEvent();
    await cardService.deleteCard(card.id);
    const event = await eventPromise;

    expect(event.type).toBe("card:deleted");
    if (event.type === "card:deleted") {
      expect(event.cardId).toBe(card.id);
    }
  });

  it("createSymlink emits node:created", async () => {
    const { card: cardA, node_id: nodeA } = await cardService.createCard({
      card_type: "structure",
      title: "A",
    });
    const { node_id: nodeB } = await cardService.createCard({
      card_type: "knowledge",
      title: "B",
      parent_node_id: nodeA,
    });

    const eventPromise = nextAtomEvent();
    const symlink = await treeService.createSymlink(cardA.id, nodeB);
    const event = await eventPromise;

    expect(event.type).toBe("node:created");
    if (event.type === "node:created") {
      expect(event.nodeId).toBe(symlink.id);
      expect(event.cardId).toBe(cardA.id);
      expect(event.parentNodeId).toBe(nodeB);
      expect(event.node.id).toBe(symlink.id);
      expect(event.node.is_symlink).toBe(true);
      expect(event.node.card.id).toBe(cardA.id);
    }
  });

  it("deleteNode emits node:deleted", async () => {
    const { node_id } = await cardService.createCard({
      card_type: "knowledge",
      title: "Node to delete",
    });

    const eventPromise = nextAtomEvent();
    await treeService.deleteNode(node_id);
    const event = await eventPromise;

    expect(event.type).toBe("node:deleted");
    if (event.type === "node:deleted") {
      expect(event.nodeId).toBe(node_id);
      expect(event.cardId).toBeDefined();
      expect(event.parentNodeId).toBeNull();
    }
  });

  it("updateNodeProperties emits node:updated", async () => {
    const { node_id } = await cardService.createCard({
      card_type: "structure",
      title: "JournalTarget",
    });

    const eventPromise = nextAtomEvent();
    await treeService.updateNodeProperties(node_id, { journal_limit: 5 });
    const event = await eventPromise;

    expect(event.type).toBe("node:updated");
    if (event.type === "node:updated") {
      expect(event.nodeId).toBe(node_id);
      expect(event.node.journal_limit).toBe(5);
    }
  });

  it("updateNodeProperties with empty props does NOT emit node:updated", async () => {
    // P1-1/P1-2 regression: a no-op update (no provided fields) must not push
    // a misleading `node:updated` to SSE consumers, and must stay symmetric
    // with the standalone update_node({node_id}) omit path.
    const { node_id } = await cardService.createCard({
      card_type: "structure",
      title: "JournalTarget NoEmit",
    });

    // Capture every event emitted within the window.
    const captured: AtomEvent[] = [];
    const handler = (event: AtomEvent) => {
      captured.push(event);
    };
    eventBus.on("atom:event", handler);

    try {
      // No-op update: omit journal_limit entirely.
      await treeService.updateNodeProperties(node_id, {});
      // Subsequent emitting update acts as a synchronization barrier so we
      // know the eventBus has had a chance to deliver any (unwanted) prior
      // node:updated event for this node.
      await treeService.updateNodeProperties(node_id, { journal_limit: 7 });
    } finally {
      eventBus.off("atom:event", handler);
    }

    // The non-empty call must emit exactly once for this node_id; the noop
    // call must not contribute any node:updated event.
    const nodeUpdated = captured.filter(
      (e) => e.type === "node:updated" && e.nodeId === node_id
    );
    expect(nodeUpdated).toHaveLength(1);
  });

  it("moveNode emits node:moved", async () => {
    const { node_id: rootA } = await cardService.createCard({
      card_type: "structure",
      title: "Root A",
    });
    const { node_id: rootB } = await cardService.createCard({
      card_type: "structure",
      title: "Root B",
    });
    const { node_id: child } = await cardService.createCard({
      card_type: "knowledge",
      title: "Movable",
      parent_node_id: rootA,
    });

    const eventPromise = nextAtomEvent();
    await treeService.moveNode(child, { parent_node_id: rootB });
    const event = await eventPromise;

    expect(event.type).toBe("node:moved");
    if (event.type === "node:moved") {
      expect(event.nodeId).toBe(child);
      expect(event.oldParentNodeId).toBe(rootA);
      expect(event.newParentNodeId).toBe(rootB);
      expect(event.node.parent_node_id).toBe(rootB);
      expect(event.affectedNodes.map((node) => node.id)).toContain(child);
    }
  });
});
