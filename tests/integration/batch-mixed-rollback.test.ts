import { executeBatchOp } from "../../src/services/batch.service.js";
import * as cardService from "../../src/services/card.service.js";
import { getIntegrationTestPool, setupIntegrationTestDb } from "./integration-harness.js";

setupIntegrationTestDb();

describe("executeBatchOp — mixed operations", () => {
  it("runs creates + updates + moves + deletes in one transaction", async () => {
    const { card: updateTarget } = await cardService.createCard({
      card_type: "knowledge",
      title: "To update",
    });
    const { card: deleteTarget } = await cardService.createCard({
      card_type: "knowledge",
      title: "To delete",
    });
    const { card: moveTarget, node_id: moveTargetNodeId } =
      await cardService.createCard({
        card_type: "knowledge",
        title: "To move",
      });

    const result = await executeBatchOp({
      creates: [
        { temp_id: "newRoot", card_type: "structure", title: "New Root" },
      ],
      updates: [{ card_id: updateTarget.id, title: "Updated" }],
      moves: [{ node_id: moveTargetNodeId, parent_temp_id: "newRoot" }],
      deletes: [{ card_id: deleteTarget.id }],
    });

    expect(result.created).toHaveLength(1);
    expect(result.updated).toContain(updateTarget.id);
    expect(result.moved).toContain(moveTargetNodeId);
    expect(result.deleted).toContain(deleteTarget.id);

    expect(moveTarget.id).toBeTruthy();
  });
});

describe("executeBatchOp — empty input", () => {
  it("handles empty batch gracefully", async () => {
    const result = await executeBatchOp({});
    expect(result.created).toHaveLength(0);
    expect(result.symlinked).toHaveLength(0);
    expect(result.updated).toHaveLength(0);
    expect(result.moved).toHaveLength(0);
    expect(result.deleted).toHaveLength(0);
  });

  it("handles all-empty arrays", async () => {
    const result = await executeBatchOp({
      creates: [],
      symlinks: [],
      updates: [],
      moves: [],
      deletes: [],
    });
    expect(result.created).toHaveLength(0);
  });
});

describe("executeBatchOp — rollback on error", () => {
  it("rolls back all operations when one fails", async () => {
    // Count cards before
    const before = await getIntegrationTestPool().query("SELECT COUNT(*) FROM cards");
    const countBefore = parseInt(before.rows[0]["count"], 10);

    await expect(
      executeBatchOp({
        creates: [
          { temp_id: "ok", card_type: "structure", title: "Should roll back" },
        ],
        updates: [
          {
            // Non-existent card_id — doesn't throw, but we can use an invalid
            // operation to trigger a DB error
            card_id: "00000000-0000-0000-0000-000000000000",
            title: "x".repeat(200), // Exceeds VARCHAR(50) limit → DB error
          },
        ],
      })
    ).rejects.toThrow();

    const after = await getIntegrationTestPool().query("SELECT COUNT(*) FROM cards");
    const countAfter = parseInt(after.rows[0]["count"], 10);

    // No cards were created — transaction was rolled back
    expect(countAfter).toBe(countBefore);
  });
});
