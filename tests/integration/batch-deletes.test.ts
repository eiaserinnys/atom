import { executeBatchOp } from "../../src/services/batch.service.js";
import * as cardService from "../../src/services/card.service.js";
import * as treeService from "../../src/services/tree.service.js";
import { getIntegrationTestPool, setupIntegrationTestDb } from "./integration-harness.js";

setupIntegrationTestDb();

describe("executeBatchOp — deletes", () => {
  it("deletes an existing card", async () => {
    const { card } = await cardService.createCard({
      card_type: "knowledge",
      title: "To delete",
    });

    const result = await executeBatchOp({
      deletes: [{ card_id: card.id }],
    });

    expect(result.deleted).toContain(card.id);

    const gone = await cardService.getCard(card.id);
    expect(gone).toBeNull();
  });

  it("records deleted card ids in input order", async () => {
    const { card: first } = await cardService.createCard({
      card_type: "knowledge",
      title: "Delete first",
    });
    const { card: second } = await cardService.createCard({
      card_type: "knowledge",
      title: "Delete second",
    });
    const { card: third } = await cardService.createCard({
      card_type: "knowledge",
      title: "Delete third",
    });

    const result = await executeBatchOp({
      deletes: [
        { card_id: second.id },
        { card_id: first.id },
        { card_id: third.id },
      ],
    });

    expect(result.deleted).toEqual([second.id, first.id, third.id]);
  });

  it("preserves structure-card cascade semantics", async () => {
    const { card: parentCard, node_id: parentNodeId } =
      await cardService.createCard({
        card_type: "structure",
        title: "Delete structure parent",
      });
    const { card: childCard, node_id: childNodeId } =
      await cardService.createCard({
        card_type: "knowledge",
        title: "Delete structure child",
        parent_node_id: parentNodeId,
      });

    const result = await executeBatchOp({
      deletes: [{ card_id: parentCard.id }],
    });

    expect(result.deleted).toEqual([parentCard.id]);
    expect(await cardService.getCard(parentCard.id)).toBeNull();
    expect(await treeService.getNode(parentNodeId)).toBeNull();
    expect(await cardService.getCard(childCard.id)).not.toBeNull();
    expect(await treeService.getNode(childNodeId)).toBeNull();
  });

  it("rolls back earlier deletes when a later delete fails", async () => {
    const { card } = await cardService.createCard({
      card_type: "knowledge",
      title: "Delete rollback target",
    });

    await expect(
      executeBatchOp({
        deletes: [
          { card_id: card.id },
          { card_id: "not-a-uuid" },
        ],
      })
    ).rejects.toThrow();

    expect(await cardService.getCard(card.id)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// executeBatchOp — symlinks
// ---------------------------------------------------------------------------
