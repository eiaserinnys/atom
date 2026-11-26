import { selectCardById } from "../db/queries/cards.js";
import {
  getNodeBreadcrumb,
  getNodeBreadcrumbs,
  selectCanonicalNodeByCardId,
  selectCanonicalNodesByCardIds,
  selectChildrenWithCardRows,
} from "../db/queries/tree.js";
import type { Queryable } from "../db/queryable.js";
import type { TreeNode, TreeNodeWithCard } from "../shared/types.js";

export async function toTreeNodeWithCard(
  db: Queryable,
  node: TreeNode
): Promise<TreeNodeWithCard> {
  const card = await selectCardById(db, node.card_id);
  if (!card) {
    throw new Error(`Card not found for node: ${node.id}`);
  }

  const nodeWithCard: TreeNodeWithCard = { ...node, card };
  if (!node.is_symlink) return nodeWithCard;

  const canonical = await selectCanonicalNodeByCardId(db, node.card_id);
  if (!canonical) return nodeWithCard;

  const parts = await getNodeBreadcrumb(db, canonical.id);
  return { ...nodeWithCard, canonical_path: parts.join(" / ") };
}

export async function selectChildrenWithCards(
  db: Queryable,
  parentNodeId: string | null
): Promise<TreeNodeWithCard[]> {
  const rows = await selectChildrenWithCardRows(db, parentNodeId);

  const symlinkCardIds = [
    ...new Set(rows.filter(({ node }) => node.is_symlink).map(({ node }) => node.card_id)),
  ];
  const canonicalByCardId = new Map<string, TreeNode>();
  for (const canonical of await selectCanonicalNodesByCardIds(db, symlinkCardIds)) {
    const current = canonicalByCardId.get(canonical.card_id);
    if (!current || canonical.id < current.id) canonicalByCardId.set(canonical.card_id, canonical);
  }
  const breadcrumbs = await getNodeBreadcrumbs(
    db,
    [...canonicalByCardId.values()].map((canonical) => canonical.id)
  );

  return rows.map(({ node, card }) => {
    const nodeWithCard: TreeNodeWithCard = { ...node, card };
    if (!node.is_symlink) return nodeWithCard;
    const canonical = canonicalByCardId.get(node.card_id);
    if (!canonical) return nodeWithCard;
    return { ...nodeWithCard, canonical_path: (breadcrumbs.get(canonical.id) ?? []).join(" / ") };
  });
}
