import { executeBatchOp } from "../../src/services/batch.service.js";
import * as cardService from "../../src/services/card.service.js";
import { getIntegrationTestPool, setupIntegrationTestDb } from "./integration-harness.js";

setupIntegrationTestDb();

describe("executeBatchOp — symlinks", () => {
  it("creates a symlink node for an existing card", async () => {
    const { card, node_id: originalNodeId } = await cardService.createCard({
      card_type: "knowledge",
      title: "Symlink target",
      content: "Some content",
    });

    const result = await executeBatchOp({
      symlinks: [
        { card_id: card.id, parent_node_id: null },
      ],
    });

    expect(result.symlinked).toHaveLength(1);
    const symlinkNodeId = result.symlinked[0];
    expect(symlinkNodeId).toBeTruthy();
    expect(symlinkNodeId).not.toBe(originalNodeId);

    // Verify node is a symlink in DB
    const nodeRow = await getIntegrationTestPool().query(
      "SELECT is_symlink, card_id FROM tree_nodes WHERE id = $1",
      [symlinkNodeId]
    );
    expect(nodeRow.rows[0]["is_symlink"]).toBe(true);
    expect(nodeRow.rows[0]["card_id"]).toBe(card.id);
  });

  it("rolls back when symlink references non-existent card_id", async () => {
    const before = await getIntegrationTestPool().query("SELECT COUNT(*) FROM tree_nodes");
    const countBefore = parseInt(before.rows[0]["count"], 10);

    await expect(
      executeBatchOp({
        creates: [
          { temp_id: "ok", card_type: "structure", title: "Should roll back" },
        ],
        symlinks: [
          {
            card_id: "00000000-0000-0000-0000-000000000000",
            parent_node_id: null,
          },
        ],
      })
    ).rejects.toThrow();

    const after = await getIntegrationTestPool().query("SELECT COUNT(*) FROM tree_nodes");
    const countAfter = parseInt(after.rows[0]["count"], 10);
    expect(countAfter).toBe(countBefore);
  });

  it("symlinks a card created earlier in the same batch", async () => {
    // First batch: create a card
    const createResult = await executeBatchOp({
      creates: [
        { temp_id: "src", card_type: "knowledge", title: "Source Card" },
        { temp_id: "dest", card_type: "structure", title: "Dest Folder" },
      ],
    });

    const srcCardId = createResult.created.find((c) => c.temp_id === "src")!.card_id;
    const destNodeId = createResult.created.find((c) => c.temp_id === "dest")!.node_id;

    // Second batch: symlink the card under the dest folder
    const symlinkResult = await executeBatchOp({
      symlinks: [
        { card_id: srcCardId, parent_node_id: destNodeId },
      ],
    });

    expect(symlinkResult.symlinked).toHaveLength(1);

    // Verify both the original node and the symlink exist for the same card
    const nodes = await getIntegrationTestPool().query(
      "SELECT id, is_symlink FROM tree_nodes WHERE card_id = $1 ORDER BY is_symlink",
      [srcCardId]
    );
    expect(nodes.rows).toHaveLength(2);
    expect(nodes.rows[0]["is_symlink"]).toBe(false);
    expect(nodes.rows[1]["is_symlink"]).toBe(true);
  });

  it("places symlink under a node created in the same batch via parent_temp_id", async () => {
    // Create a card to symlink
    const { card: srcCard } = await cardService.createCard({
      card_type: "knowledge",
      title: "Symlink source",
    });

    // Single batch: create a folder and place a symlink under it using parent_temp_id
    const result = await executeBatchOp({
      creates: [
        { temp_id: "folder", card_type: "structure", title: "New Folder" },
      ],
      symlinks: [
        { card_id: srcCard.id, parent_temp_id: "folder" },
      ],
    });

    expect(result.created).toHaveLength(1);
    expect(result.symlinked).toHaveLength(1);

    const folderNodeId = result.created[0].node_id;
    const symlinkNodeId = result.symlinked[0];

    // Verify the symlink node is a child of the newly created folder
    const nodeRow = await getIntegrationTestPool().query(
      "SELECT parent_node_id, is_symlink FROM tree_nodes WHERE id = $1",
      [symlinkNodeId]
    );
    expect(nodeRow.rows[0]["parent_node_id"]).toBe(folderNodeId);
    expect(nodeRow.rows[0]["is_symlink"]).toBe(true);
  });

  it("throws when parent_temp_id references a temp_id not in the same batch", async () => {
    const { card } = await cardService.createCard({
      card_type: "knowledge",
      title: "Orphan symlink source",
    });

    await expect(
      executeBatchOp({
        symlinks: [
          { card_id: card.id, parent_temp_id: "nonexistent-temp-id" },
        ],
      })
    ).rejects.toThrow('parent_temp_id "nonexistent-temp-id" not found among batch creates');
  });

  it("rolls back creates when symlink parent_temp_id is missing", async () => {
    const { card } = await cardService.createCard({
      card_type: "knowledge",
      title: "Rollback symlink source",
    });
    const before = await getIntegrationTestPool().query("SELECT COUNT(*) FROM tree_nodes");
    const countBefore = parseInt(before.rows[0]["count"], 10);

    await expect(
      executeBatchOp({
        creates: [
          { temp_id: "created", card_type: "structure", title: "Should roll back" },
        ],
        symlinks: [
          { card_id: card.id, parent_temp_id: "missing-created-parent" },
        ],
      })
    ).rejects.toThrow(
      'Symlink: parent_temp_id "missing-created-parent" not found among batch creates'
    );

    const after = await getIntegrationTestPool().query("SELECT COUNT(*) FROM tree_nodes");
    const countAfter = parseInt(after.rows[0]["count"], 10);
    expect(countAfter).toBe(countBefore);
  });
});

// ---------------------------------------------------------------------------
// executeBatchOp — mixed operations
// ---------------------------------------------------------------------------
