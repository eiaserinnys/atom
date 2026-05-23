import { selectCardById } from "../db/queries/cards.js";
import {
  getNodeBreadcrumb,
  selectChildren,
  selectCanonicalNodeByCardId,
  selectNodeById,
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

export async function selectTreeNodeWithCardById(
  db: Queryable,
  nodeId: string
): Promise<TreeNodeWithCard | null> {
  const node = await selectNodeById(db, nodeId);
  if (!node) return null;
  return toTreeNodeWithCard(db, node);
}

export async function selectChildrenWithCards(
  db: Queryable,
  parentNodeId: string | null
): Promise<TreeNodeWithCard[]> {
  const children = await selectChildren(db, parentNodeId);
  const result: TreeNodeWithCard[] = [];
  for (const node of children) {
    result.push(await toTreeNodeWithCard(db, node));
  }
  return result;
}
