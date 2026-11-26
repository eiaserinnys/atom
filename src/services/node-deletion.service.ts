import type { Queryable } from "../db/queryable.js";
import type { TreeNode } from "../shared/types.js";
import { selectCardById, deleteCardById } from "../db/queries/cards.js";
import {
  selectNodeById,
  selectNodesByCardId,
} from "../db/queries/tree.js";
import { deserializeBoolean } from "../db/utils.js";

interface DeletionNodeRow {
  id: string;
  card_id: string;
  parent_node_id: string | null;
  is_symlink: boolean;
  has_outside_node: boolean;
  scope_depth: number | null;
}

export interface DeletedCardNodes {
  cardId: string;
  nodeIds: string[];
  parentNodeIds: (string | null)[];
}

export type TreeDeletionTarget =
  | { nodeId: string }
  | { cardId: string };

/**
 * What deleting a target removes. The nodes are the target's subtree (the
 * scope, reached by parent links) plus, repeatedly, the symlink nodes of every
 * card whose only canonical node is already collected and everything below
 * those symlinks. A card is deleted when no node of it is left outside the
 * collection.
 * `isCanonicalTarget` is false only when the target is a single symlink node.
 * `deletedLinkCount` counts the symlink nodes removed outside the scope,
 * leaving out the nodes below another removed outside node.
 * `deleteRootNodeIds` are the collected nodes whose parent is not collected;
 * deleting them removes the rest through the parent cascade.
 */
export interface TreeDeletionPlan {
  rootNode: TreeNode | null;
  isCanonicalTarget: boolean;
  nodeIds: string[];
  deleteRootNodeIds: string[];
  deletedCards: DeletedCardNodes[];
  deletedLinkCount: number;
}

export interface DeletionSummary {
  deletedCardIds: string[];
  deletedNodeCount: number;
  deletedLinkCount: number;
}

export interface TreeDeletionResult {
  deleted: boolean;
  rootNode: TreeNode | null;
  deletedCards: DeletedCardNodes[];
  deletedNodeCount: number;
  deletedLinkCount: number;
}

export function summarizeDeletion(
  deletion: { deletedCards: DeletedCardNodes[]; nodeIds: string[]; deletedLinkCount: number }
): DeletionSummary {
  return {
    deletedCardIds: deletion.deletedCards.map((card) => card.cardId),
    deletedNodeCount: deletion.nodeIds.length,
    deletedLinkCount: deletion.deletedLinkCount,
  };
}

export function summarizeDeletedTree(result: TreeDeletionResult): DeletionSummary {
  return {
    deletedCardIds: result.deletedCards.map((card) => card.cardId),
    deletedNodeCount: result.deletedNodeCount,
    deletedLinkCount: result.deletedLinkCount,
  };
}

/**
 * One recursive reference per CTE keeps PostgreSQL happy: the closure joins
 * children and canonical-to-symlink hops in a single ON condition. UNION drops
 * repeated nodes, so loops between cards end.
 */
const DELETION_CTES = (rootCount: number): string => {
  const roots = Array.from({ length: rootCount }, (_, index) => `($${index + 1})`).join(", ");
  return `WITH RECURSIVE roots(id) AS (VALUES ${roots}),
     scope(id, depth) AS (
       SELECT node.id, 0
       FROM tree_nodes node
       JOIN roots root ON root.id = CAST(node.id AS TEXT)
       UNION
       SELECT child.id, parent.depth + 1
       FROM tree_nodes child
       JOIN scope parent ON child.parent_node_id = parent.id
     ),
     single_canonical(card_id) AS (
       SELECT card_id FROM tree_nodes WHERE NOT is_symlink GROUP BY card_id HAVING COUNT(*) = 1
     ),
     closure(id, card_id, parent_node_id, is_symlink, created_at) AS (
       SELECT node.id, node.card_id, node.parent_node_id, node.is_symlink, node.created_at
       FROM tree_nodes node
       JOIN roots root ON root.id = CAST(node.id AS TEXT)
       UNION
       SELECT next.id, next.card_id, next.parent_node_id, next.is_symlink, next.created_at
       FROM tree_nodes next
       JOIN closure current
         ON next.parent_node_id = current.id
         OR (
           next.card_id = current.card_id
           AND NOT current.is_symlink
           AND next.is_symlink
           AND current.card_id IN (SELECT card_id FROM single_canonical)
         )
     )`;
};

async function selectDeletionNodes(
  db: Queryable,
  rootNodeIds: string[]
): Promise<DeletionNodeRow[]> {
  if (rootNodeIds.length === 0) return [];

  const result = await db.query(
    `${DELETION_CTES(rootNodeIds.length)}
     SELECT c.id, c.card_id, c.parent_node_id, c.is_symlink,
       CASE WHEN EXISTS (
         SELECT 1 FROM tree_nodes outside
         WHERE outside.card_id = c.card_id
           AND outside.id NOT IN (SELECT id FROM closure)
       ) THEN 1 ELSE 0 END AS has_outside_node,
       (SELECT MIN(scope.depth) FROM scope WHERE scope.id = c.id) AS scope_depth
     FROM closure c
     ORDER BY c.created_at, c.id`,
    rootNodeIds
  );
  const rows = result.rows.map((row) => ({
    id: row["id"] as string,
    card_id: row["card_id"] as string,
    parent_node_id: (row["parent_node_id"] as string | null) ?? null,
    is_symlink: deserializeBoolean(row["is_symlink"]),
    has_outside_node: Number(row["has_outside_node"]) > 0,
    scope_depth: row["scope_depth"] === null || row["scope_depth"] === undefined
      ? null
      : Number(row["scope_depth"]),
  }));
  const depthOf = (row: DeletionNodeRow) => row.scope_depth ?? Number.MAX_SAFE_INTEGER;
  return rows.sort((a, b) => depthOf(a) - depthOf(b));
}

function countOtherPlaceLinks(nodes: DeletionNodeRow[]): number {
  const outsideIds = new Set(
    nodes.filter((node) => node.scope_depth === null).map((node) => node.id)
  );
  return nodes.filter((node) =>
    node.scope_depth === null
    && node.is_symlink
    && (node.parent_node_id === null || !outsideIds.has(node.parent_node_id))
  ).length;
}

async function deleteNodesById(db: Queryable, nodeIds: string[]): Promise<number> {
  let deleted = 0;
  for (let start = 0; start < nodeIds.length; start += 500) {
    const chunk = nodeIds.slice(start, start + 500);
    const placeholders = chunk.map((_, index) => `$${index + 1}`).join(", ");
    const result = await db.query(
      `DELETE FROM tree_nodes WHERE id IN (${placeholders})`,
      chunk
    );
    deleted += result.rowCount ?? 0;
  }
  return deleted;
}

async function toDeletedCardNodes(
  db: Queryable,
  cardId: string,
  nodes: DeletionNodeRow[]
): Promise<DeletedCardNodes> {
  const cardNodes = nodes.filter((node) => node.card_id === cardId);
  // A deleted card has every node inside the collection. Several nodes can share
  // a created_at (SQLite keeps whole seconds), so their order comes from the
  // query that getCardNodes uses.
  const ordered = cardNodes.length > 1
    ? await selectNodesByCardId(db, cardId)
    : cardNodes;
  return {
    cardId,
    nodeIds: ordered.map((node) => node.id),
    parentNodeIds: ordered.map((node) => node.parent_node_id),
  };
}

/**
 * Works out what deleting the target would remove, without deleting anything.
 * The same plan drives the real deletion, so a preview and a deletion run in
 * the same transaction agree. Returns null when the target does not exist.
 */
export async function planTreeDeletion(
  db: Queryable,
  target: TreeDeletionTarget
): Promise<TreeDeletionPlan | null> {
  let rootNode: TreeNode | null = null;
  let rootNodes: TreeNode[];
  let requestedCardId: string | null = null;

  if ("nodeId" in target) {
    rootNode = await selectNodeById(db, target.nodeId);
    if (!rootNode) return null;
    rootNodes = [rootNode];
  } else {
    if (!(await selectCardById(db, target.cardId))) return null;
    requestedCardId = target.cardId;
    rootNodes = await selectNodesByCardId(db, target.cardId);
  }

  const rootNodeIds = rootNodes.map((node) => node.id);
  const subtreeNodes = await selectDeletionNodes(db, rootNodeIds);
  const collectedIds = new Set(subtreeNodes.map((node) => node.id));
  const deleteRootNodeIds = subtreeNodes
    .filter((node) => node.parent_node_id === null || !collectedIds.has(node.parent_node_id))
    .map((node) => node.id);

  const firstCardId = requestedCardId ?? rootNode!.card_id;
  const orphanCardIds = [...new Set(
    subtreeNodes.filter((node) => !node.has_outside_node).map((node) => node.card_id)
  )];
  const deletedCardIds = requestedCardId !== null
    ? [requestedCardId, ...orphanCardIds.filter((cardId) => cardId !== requestedCardId)]
    : [
        ...orphanCardIds.filter((cardId) => cardId === firstCardId),
        ...orphanCardIds.filter((cardId) => cardId !== firstCardId),
      ];

  const deletedCards: DeletedCardNodes[] = [];
  for (const cardId of deletedCardIds) {
    deletedCards.push(await toDeletedCardNodes(db, cardId, subtreeNodes));
  }

  return {
    rootNode,
    isCanonicalTarget: rootNode === null || !rootNode.is_symlink,
    nodeIds: subtreeNodes.map((node) => node.id),
    deleteRootNodeIds,
    deletedCards,
    deletedLinkCount: countOtherPlaceLinks(subtreeNodes),
  };
}

/**
 * Deletes a node subtree or a card with its node subtrees, the symlink nodes of
 * every card whose canonical node is deleted, and the cards left without a tree
 * node. Callers pass a transaction client so tree and card changes commit
 * atomically.
 */
export async function deleteTreeAndOrphanCards(
  db: Queryable,
  target: TreeDeletionTarget
): Promise<TreeDeletionResult> {
  const plan = await planTreeDeletion(db, target);
  const notDeleted = (rootNode: TreeNode | null): TreeDeletionResult => ({
    deleted: false,
    rootNode,
    deletedCards: [],
    deletedNodeCount: 0,
    deletedLinkCount: 0,
  });
  if (!plan) return notDeleted(null);

  const removedNodes = await deleteNodesById(db, plan.deleteRootNodeIds);
  const requestedCardId = "cardId" in target ? target.cardId : null;
  if (requestedCardId !== null) {
    if (!(await deleteCardById(db, requestedCardId))) return notDeleted(plan.rootNode);
  } else if (removedNodes === 0) {
    return notDeleted(plan.rootNode);
  }

  const deletedCards: DeletedCardNodes[] = [];
  for (const planned of plan.deletedCards) {
    if (planned.cardId === requestedCardId) {
      deletedCards.push(planned);
      continue;
    }
    const result = await db.query(
      `DELETE FROM cards
       WHERE id = $1
         AND NOT EXISTS (SELECT 1 FROM tree_nodes WHERE card_id = $2)
       RETURNING id`,
      [planned.cardId, planned.cardId]
    );
    if ((result.rowCount ?? result.rows.length) > 0) deletedCards.push(planned);
  }

  return {
    deleted: true,
    rootNode: plan.rootNode,
    deletedCards,
    deletedNodeCount: plan.nodeIds.length,
    deletedLinkCount: plan.deletedLinkCount,
  };
}
