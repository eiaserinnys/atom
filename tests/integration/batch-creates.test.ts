import { executeBatchOp } from "../../src/services/batch.service.js";
import * as cardService from "../../src/services/card.service.js";
import { getIntegrationTestPool, setupIntegrationTestDb } from "./integration-harness.js";

setupIntegrationTestDb();

describe("executeBatchOp — creates", () => {
  it("creates a structure card with a child knowledge card", async () => {
    const result = await executeBatchOp({
      creates: [
        { temp_id: "root", card_type: "structure", title: "Root Section" },
        {
          temp_id: "child",
          card_type: "knowledge",
          title: "A fact",
          content: "Detail here",
          parent_temp_id: "root",
          source_type: "slack",
          source_ref: "#general, 2026-04-02",
        },
      ],
    });

    expect(result.created).toHaveLength(2);
    const rootEntry = result.created.find((c) => c.temp_id === "root")!;
    const childEntry = result.created.find((c) => c.temp_id === "child")!;

    expect(rootEntry.card_id).toBeTruthy();
    expect(rootEntry.node_id).toBeTruthy();
    expect(childEntry.card_id).toBeTruthy();
    expect(childEntry.node_id).toBeTruthy();

    // Verify parent-child relationship in DB
    const nodeRow = await getIntegrationTestPool().query(
      "SELECT parent_node_id FROM tree_nodes WHERE id = $1",
      [childEntry.node_id]
    );
    expect(nodeRow.rows[0]["parent_node_id"]).toBe(rootEntry.node_id);
  });

  it("does not create partial data when a create parent_temp_id is missing", async () => {
    const before = await getIntegrationTestPool().query("SELECT COUNT(*) FROM cards");
    const countBefore = parseInt(before.rows[0]["count"], 10);

    await expect(
      executeBatchOp({
        creates: [
          { temp_id: "ok", card_type: "structure", title: "Should not persist" },
          {
            temp_id: "bad",
            parent_temp_id: "missing-parent",
            card_type: "knowledge",
            title: "Missing parent",
          },
        ],
      })
    ).rejects.toThrow(
      'parent_temp_id "missing-parent" referenced by "bad" not found in creates'
    );

    const after = await getIntegrationTestPool().query("SELECT COUNT(*) FROM cards");
    const countAfter = parseInt(after.rows[0]["count"], 10);
    expect(countAfter).toBe(countBefore);
  });

  it("returns correct temp_id mapping", async () => {
    const result = await executeBatchOp({
      creates: [
        { temp_id: "t1", card_type: "knowledge", title: "Card 1" },
        { temp_id: "t2", card_type: "knowledge", title: "Card 2" },
      ],
    });

    const tempIds = result.created.map((c) => c.temp_id).sort();
    expect(tempIds).toEqual(["t1", "t2"]);

    // Both cards actually exist in DB
    for (const item of result.created) {
      const card = await cardService.getCard(item.card_id);
      expect(card).not.toBeNull();
    }
  });
});
