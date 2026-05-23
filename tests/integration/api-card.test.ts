/**
 * Integration tests split from api.test.ts.
 *
 * Requires TEST_DATABASE_URL to point to a test PostgreSQL database.
 */

import { setupIntegrationTestDb } from "./integration-harness.js";
import * as cardService from "../../src/services/card.service.js";
import * as treeService from "../../src/services/tree.service.js";

setupIntegrationTestDb();

describe("Card CRUD", () => {
  it("creates a knowledge card and retrieves it", async () => {
    const { card, node_id } = await cardService.createCard({
      card_type: "knowledge",
      title: "Test Card",
      content: "Hello World",
      tags: ["tag1"],
    });

    expect(card.id).toBeTruthy();
    expect(card.card_type).toBe("knowledge");
    expect(card.title).toBe("Test Card");
    expect(card.content).toBe("Hello World");
    expect(card.staleness).toBe("unverified");
    expect(node_id).toBeTruthy();

    const fetched = await cardService.getCard(card.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.title).toBe("Test Card");
  });

  it("creates a structure card with null content", async () => {
    const { card } = await cardService.createCard({
      card_type: "structure",
      title: "Root",
      content: null,
    });

    expect(card.card_type).toBe("structure");
    expect(card.content).toBeNull();
  });

  it("updates a card and auto-updates content_timestamp", async () => {
    const { card } = await cardService.createCard({
      card_type: "knowledge",
      title: "Before Update",
      content: "Original",
    });

    expect(card.content_timestamp).toBeNull();

    const updated = await cardService.updateCard(card.id, {
      content: "Updated content",
    });

    expect(updated).not.toBeNull();
    expect(updated!.conflict).toBe(false);
    const updatedCard = (updated as { card: typeof card; conflict: false }).card;
    expect(updatedCard.content).toBe("Updated content");
    expect(updatedCard.content_timestamp).not.toBeNull();
    expect(updatedCard.version).toBe(2);
  });

  it("does not auto-update content_timestamp when caller provides one", async () => {
    const { card } = await cardService.createCard({
      card_type: "knowledge",
      title: "Card",
      content: "Content",
    });

    const ts = "2020-01-01T00:00:00Z";
    const updated = await cardService.updateCard(card.id, {
      content: "New content",
      content_timestamp: ts,
    });

    expect(updated).not.toBeNull();
    expect(updated!.conflict).toBe(false);
    const updatedCard = (updated as { card: import("../../src/shared/types.js").Card; conflict: false }).card;
    expect(updatedCard.content_timestamp).not.toBeNull();
    // The provided timestamp should be used (not auto-generated)
    const raw = new Date(updatedCard.content_timestamp!).getFullYear();
    expect(raw).toBe(2020);
  });

  it("staleness is present in get_card response", async () => {
    const { card } = await cardService.createCard({
      card_type: "knowledge",
      title: "Staleness card",
    });

    const fetched = await cardService.getCard(card.id);
    expect(fetched).toHaveProperty("staleness");
    expect(fetched!.staleness).toBe("unverified");
  });

  it("deletes a card and cascades tree_nodes", async () => {
    const { card, node_id } = await cardService.createCard({
      card_type: "knowledge",
      title: "To Delete",
    });

    const deleted = await cardService.deleteCard(card.id);
    expect(deleted).toBe(true);

    const fetched = await cardService.getCard(card.id);
    expect(fetched).toBeNull();

    // Tree node should also be gone (CASCADE)
    const node = await treeService.getNode(node_id);
    expect(node).toBeNull();
  });

  it("returns null for non-existent card", async () => {
    const card = await cardService.getCard("00000000-0000-0000-0000-000000000000");
    expect(card).toBeNull();
  });
});

describe("Backlinks", () => {
  it("returns cards that reference the target card", async () => {
    const { card: target } = await cardService.createCard({
      card_type: "knowledge",
      title: "Target",
    });

    const { card: ref1 } = await cardService.createCard({
      card_type: "knowledge",
      title: "Ref1",
      references: [target.id],
    });

    const { card: ref2 } = await cardService.createCard({
      card_type: "knowledge",
      title: "Ref2",
      references: [target.id],
    });

    // Not a reference
    await cardService.createCard({
      card_type: "knowledge",
      title: "Unrelated",
    });

    const backlinks = await cardService.getBacklinks(target.id);
    const backIds = backlinks.map((c) => c.id);
    expect(backIds).toContain(ref1.id);
    expect(backIds).toContain(ref2.id);
    expect(backIds).not.toContain(target.id);
  });
});

describe("Optimistic locking", () => {
  it("succeeds when expected_version matches current version", async () => {
    const { card } = await cardService.createCard({
      card_type: "knowledge",
      title: "Version card",
      content: "v1",
    });
    expect(card.version).toBe(1);

    const result = await cardService.updateCard("test-agent", card.id, { title: "v2" }, 1);
    expect(result).not.toBeNull();
    expect(result!.conflict).toBe(false);
    const updated = (result as { card: typeof card; conflict: false }).card;
    expect(updated.version).toBe(2);
    expect(updated.title).toBe("v2");
  });

  it("returns VersionConflict (409-equivalent) when expected_version does not match", async () => {
    const { card } = await cardService.createCard({
      card_type: "knowledge",
      title: "Conflict card",
      content: "original",
    });
    expect(card.version).toBe(1);

    // Simulate stale expected_version (0 instead of 1)
    const result = await cardService.updateCard("test-agent", card.id, { title: "stale update" }, 0);
    expect(result).not.toBeNull();
    expect(result!.conflict).toBe(true);
    if (result && result.conflict) {
      expect(result.actualVersion).toBe(1);
    }
  });
});
