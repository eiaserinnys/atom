import { getDb } from "../../src/db/client.js";
import { selectNodeById } from "../../src/db/queries/tree.js";
import { createCard } from "../../src/services/card.service.js";
import { normalizeSearchRootNodeId } from "../../src/services/search.service.js";
import { createSymlink } from "../../src/services/tree.service.js";

async function cardWithRootSymlink(): Promise<{ cardId: string; canonicalNodeId: string; aliasNodeId: string }> {
  const { card, node_id: canonicalNodeId } = await createCard({ card_type: "structure", title: "Original" });
  const alias = await createSymlink(card.id, null);
  return { cardId: card.id, canonicalNodeId, aliasNodeId: alias.id };
}

export function defineTreeParentScenarios(): void {
  describe("a symlink parent resolves to the card's canonical node", () => {
    it("a card without a canonical node keeps the symlink node itself as the parent", async () => {
      const { canonicalNodeId, aliasNodeId } = await cardWithRootSymlink();
      await getDb().query("DELETE FROM tree_nodes WHERE id = $1", [canonicalNodeId]);

      const created = await createCard({
        card_type: "knowledge",
        title: "Created under a symlink-only card",
        parent_node_id: aliasNodeId,
      });

      expect((await selectNodeById(getDb(), created.node_id))?.parent_node_id).toBe(aliasNodeId);
      expect(await normalizeSearchRootNodeId(aliasNodeId)).toBe(aliasNodeId);
    });

    it("a card with two canonical nodes resolves to one of them", async () => {
      const { cardId, canonicalNodeId, aliasNodeId } = await cardWithRootSymlink();
      await getDb().query("UPDATE tree_nodes SET is_symlink = FALSE WHERE id = $1", [aliasNodeId]);
      const third = await createCard({ card_type: "structure", title: "Third place" });
      const thirdAlias = await createSymlink(cardId, third.node_id);

      const created = await createCard({
        card_type: "knowledge",
        title: "Created under a two-canonical card",
        parent_node_id: thirdAlias.id,
      });

      const parentNodeId = (await selectNodeById(getDb(), created.node_id))?.parent_node_id;
      expect([canonicalNodeId, aliasNodeId]).toContain(parentNodeId);
      expect([canonicalNodeId, aliasNodeId]).toContain(await normalizeSearchRootNodeId(thirdAlias.id));
    });
  });
}
