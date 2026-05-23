import { executeBatchOp } from "../../src/services/batch.service.js";
import * as cardService from "../../src/services/card.service.js";
import { getIntegrationTestPool, setupIntegrationTestDb } from "./integration-harness.js";

setupIntegrationTestDb();

describe("executeBatchOp — updates", () => {
  it("updates an existing card's title and content", async () => {
    const { card } = await cardService.createCard({
      card_type: "knowledge",
      title: "Original",
      content: "Old content",
    });

    await executeBatchOp({
      updates: [
        { card_id: card.id, title: "Updated Title", content: "New content" },
      ],
    });

    const updated = await cardService.getCard(card.id);
    expect(updated!.title).toBe("Updated Title");
    expect(updated!.content).toBe("New content");
    expect(updated!.version).toBeGreaterThan(card.version);
  });

  it("records updated card ids in input order", async () => {
    const { card: first } = await cardService.createCard({
      card_type: "knowledge",
      title: "First",
    });
    const { card: second } = await cardService.createCard({
      card_type: "knowledge",
      title: "Second",
    });

    const result = await executeBatchOp({
      updates: [
        { card_id: second.id, title: "Second updated" },
        { card_id: first.id, title: "First updated" },
      ],
    });

    expect(result.updated).toEqual([second.id, first.id]);
  });

  it("auto-updates content_timestamp when content changes", async () => {
    const { card } = await cardService.createCard({
      card_type: "knowledge",
      title: "Timestamp target",
      content: "Before",
    });
    expect(card.content_timestamp).toBeNull();

    await executeBatchOp({
      updates: [{ card_id: card.id, content: "After" }],
    });

    const updated = await cardService.getCard(card.id);
    expect(updated!.content).toBe("After");
    expect(updated!.content_timestamp).not.toBeNull();
  });

  it("uses caller-provided content_timestamp when content changes", async () => {
    const { card } = await cardService.createCard({
      card_type: "knowledge",
      title: "Explicit timestamp target",
      content: "Before",
    });
    const explicitTimestamp = "2020-01-01T00:00:00Z";

    await executeBatchOp({
      updates: [
        {
          card_id: card.id,
          content: "After",
          content_timestamp: explicitTimestamp,
        },
      ],
    });

    const updated = await cardService.getCard(card.id);
    expect(updated!.content).toBe("After");
    expect(updated!.content_timestamp).not.toBeNull();
    expect(new Date(updated!.content_timestamp!).getUTCFullYear()).toBe(2020);
  });

  it("throws Card not found and rolls back earlier updates", async () => {
    const { card } = await cardService.createCard({
      card_type: "knowledge",
      title: "Rollback target",
    });
    const missingCardId = "00000000-0000-0000-0000-000000000000";

    await expect(
      executeBatchOp({
        updates: [
          { card_id: card.id, title: "Should roll back" },
          { card_id: missingCardId, title: "Missing" },
        ],
      })
    ).rejects.toThrow(`Card not found: ${missingCardId}`);

    const unchanged = await cardService.getCard(card.id);
    expect(unchanged!.title).toBe("Rollback target");
    expect(unchanged!.version).toBe(card.version);
  });

  it("throws VersionConflict and rolls back earlier updates", async () => {
    const { card: earlier } = await cardService.createCard({
      card_type: "knowledge",
      title: "Earlier target",
    });
    const { card: stale } = await cardService.createCard({
      card_type: "knowledge",
      title: "Stale target",
    });

    await expect(
      executeBatchOp({
        updates: [
          { card_id: earlier.id, title: "Should roll back" },
          { card_id: stale.id, title: "Stale write", expected_version: 0 },
        ],
      })
    ).rejects.toThrow(
      `VersionConflict: card ${stale.id} expected version 0, actual ${stale.version}`
    );

    const unchangedEarlier = await cardService.getCard(earlier.id);
    const unchangedStale = await cardService.getCard(stale.id);
    expect(unchangedEarlier!.title).toBe("Earlier target");
    expect(unchangedEarlier!.version).toBe(earlier.version);
    expect(unchangedStale!.title).toBe("Stale target");
    expect(unchangedStale!.version).toBe(stale.version);
  });
});
