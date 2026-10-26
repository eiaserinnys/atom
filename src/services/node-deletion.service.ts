import type { Queryable } from "../db/queryable.js";
import type { TreeNode } from "../shared/types.js";
import { deleteCardById } from "../db/queries/cards.js";
import {
  deleteNodeById,
  selectNodeById,
  selectNodesByCardId,
} from "../db/queries/tree.js";

interface SubtreeNodeRow {
  id: string;
  card_id: string;
  parent_node_id: string | null;
}

export interface DeletedCardNodes {
  cardId: string;
  nodeIds: string[];
  parentNodeIds: (string | null)[];
}

export type TreeDeletionTarget =
  | { nodeId: string }
  | { cardId: string };

export interface TreeDeletionResult {
  deleted: boolean;
  rootNode: TreeNode | null;
  deletedCards: DeletedCardNodes[];
}

async function selectSubtreeNodes(
  db: Queryable,
  rootNodeIds: string[]
): Promise<SubtreeNodeRow[]> {
  if (rootNodeIds.length === 0) return [];

  const roots = rootNodeIds.map((_, index) => `($${index + 1})`).join(", ");
  const result = await db.query(
    `WITH RECURSIVE roots(id) AS (VALUES ${roots}),
     subtree(id, card_id, parent_node_id) AS (
       SELECT node.id, node.card_id, node.parent_node_id
       FROM tree_nodes node
       JOIN roots root ON root.id = CAST(node.id AS TEXT)
       UNION
       SELECT child.id, child.card_id, child.parent_node_id
       FROM tree_nodes child
       JOIN subtree parent ON child.parent_node_id = parent.id
     )
     SELECT id, card_id, parent_node_id FROM subtree`,
    rootNodeIds
  );
  return result.rows as SubtreeNodeRow[];
}

function toDeletedCardNodes(
  cardId: string,
  nodes: SubtreeNodeRow[]
): DeletedCardNodes {
  const cardNodes = nodes.filter((node) => node.card_id === cardId);
  return {
    cardId,
    nodeIds: cardNodes.map((node) => node.id),
    parentNodeIds: cardNodes.map((node) => node.parent_node_id),
  };
}

/**
 * Deletes a node subtree or a card and its node subtrees, then removes cards
 * that have no tree node left. Callers pass a transaction client so tree and
 * card changes commit atomically.
 */
export async function deleteTreeAndOrphanCards(
  db: Queryable,
  target: TreeDeletionTarget
): Promise<TreeDeletionResult> {
  let rootNode: TreeNode | null = null;
  let rootNodes: TreeNode[];
  let requestedCardId: string | null = null;

  if ("nodeId" in target) {
    rootNode = await selectNodeById(db, target.nodeId);
    rootNodes = rootNode ? [rootNode] : [];
  } else {
    requestedCardId = target.cardId;
    rootNodes = await selectNodesByCardId(db, target.cardId);
  }

  const subtreeNodes = await selectSubtreeNodes(
    db,
    rootNodes.map((node) => node.id)
  );

  const deleted = "nodeId" in target
    ? await deleteNodeById(db, target.nodeId)
    : await deleteCardById(db, target.cardId);
  if (!deleted) return { deleted: false, rootNode, deletedCards: [] };

  const deletedCards: DeletedCardNodes[] = [];
  if (requestedCardId !== null) {
    deletedCards.push(toDeletedCardNodes(
      requestedCardId,
      rootNodes.map((node) => ({
        id: node.id,
        card_id: node.card_id,
        parent_node_id: node.parent_node_id,
      }))
    ));
  }

  const candidateCardIds = [...new Set(subtreeNodes.map((node) => node.card_id))]
    .filter((cardId) => cardId !== requestedCardId);
  for (const cardId of candidateCardIds) {
    const result = await db.query(
      `DELETE FROM cards
       WHERE id = $1
         AND NOT EXISTS (SELECT 1 FROM tree_nodes WHERE card_id = $2)
       RETURNING id`,
      [cardId, cardId]
    );
    if ((result.rowCount ?? result.rows.length) > 0) {
      deletedCards.push(toDeletedCardNodes(cardId, subtreeNodes));
    }
  }

  return { deleted: true, rootNode, deletedCards };
}
