import type { Queryable } from "../db/queryable.js";
import type { TreeNode } from "../shared/types.js";
import { selectCardById, deleteCardById } from "../db/queries/cards.js";
import {
  deleteNodeById,
  selectNodeById,
  selectNodesByCardId,
} from "../db/queries/tree.js";
import { deserializeBoolean } from "../db/utils.js";

interface SubtreeNodeRow {
  id: string;
  card_id: string;
  parent_node_id: string | null;
  is_symlink: boolean;
  has_outside_node: boolean;
}

export interface DeletedCardNodes {
  cardId: string;
  nodeIds: string[];
  parentNodeIds: (string | null)[];
}

export interface RemainingSymlinkNode {
  nodeId: string;
  cardId: string;
  parentNodeId: string | null;
}

export type TreeDeletionTarget =
  | { nodeId: string }
  | { cardId: string };

/**
 * What deleting a target removes: every node of the subtrees below the target
 * and every card in them that has no node outside those subtrees.
 * `isCanonicalTarget` is false only when the target is a single symlink node.
 * `remainingSymlinks` are the symlink nodes left outside the subtrees whose
 * original (non-symlink) node is deleted.
 */
export interface TreeDeletionPlan {
  rootNode: TreeNode | null;
  isCanonicalTarget: boolean;
  nodeIds: string[];
  deletedCards: DeletedCardNodes[];
  remainingSymlinks: RemainingSymlinkNode[];
}

export interface TreeDeletionResult {
  deleted: boolean;
  rootNode: TreeNode | null;
  deletedCards: DeletedCardNodes[];
  deletedNodeCount: number;
}

export interface DeletionSummary {
  deletedCardIds: string[];
  deletedNodeCount: number;
}

export function summarizeDeletion(
  deletion: { deletedCards: DeletedCardNodes[]; nodeIds: string[] }
): DeletionSummary {
  return {
    deletedCardIds: deletion.deletedCards.map((card) => card.cardId),
    deletedNodeCount: deletion.nodeIds.length,
  };
}

function subtreeCte(rootCount: number): string {
  const roots = Array.from({ length: rootCount }, (_, index) => `($${index + 1})`).join(", ");
  return `WITH RECURSIVE roots(id) AS (VALUES ${roots}),
     subtree(id, card_id, parent_node_id, is_symlink, created_at, depth) AS (
       SELECT node.id, node.card_id, node.parent_node_id, node.is_symlink, node.created_at, 0
       FROM tree_nodes node
       JOIN roots root ON root.id = CAST(node.id AS TEXT)
       UNION
       SELECT child.id, child.card_id, child.parent_node_id, child.is_symlink, child.created_at, parent.depth + 1
       FROM tree_nodes child
       JOIN subtree parent ON child.parent_node_id = parent.id
     )`;
}

async function selectSubtreeNodes(
  db: Queryable,
  rootNodeIds: string[]
): Promise<SubtreeNodeRow[]> {
  if (rootNodeIds.length === 0) return [];

  const result = await db.query(
    `${subtreeCte(rootNodeIds.length)}
     SELECT s.id, s.card_id, s.parent_node_id, s.is_symlink,
       CASE WHEN EXISTS (
         SELECT 1 FROM tree_nodes outside
         WHERE outside.card_id = s.card_id
           AND outside.id NOT IN (SELECT id FROM subtree)
       ) THEN 1 ELSE 0 END AS has_outside_node
     FROM subtree s
     ORDER BY s.depth, s.created_at, s.id`,
    rootNodeIds
  );
  return result.rows.map((row) => ({
    id: row["id"] as string,
    card_id: row["card_id"] as string,
    parent_node_id: (row["parent_node_id"] as string | null) ?? null,
    is_symlink: deserializeBoolean(row["is_symlink"]),
    has_outside_node: Number(row["has_outside_node"]) > 0,
  }));
}

async function selectRemainingSymlinks(
  db: Queryable,
  rootNodeIds: string[]
): Promise<RemainingSymlinkNode[]> {
  if (rootNodeIds.length === 0) return [];

  const result = await db.query(
    `${subtreeCte(rootNodeIds.length)}
     SELECT alias.id, alias.card_id, alias.parent_node_id
     FROM tree_nodes alias
     WHERE alias.is_symlink
       AND alias.card_id IN (SELECT card_id FROM subtree WHERE NOT is_symlink)
       AND alias.id NOT IN (SELECT id FROM subtree)
     ORDER BY alias.created_at, alias.id`,
    rootNodeIds
  );
  return result.rows.map((row) => ({
    nodeId: row["id"] as string,
    cardId: row["card_id"] as string,
    parentNodeId: (row["parent_node_id"] as string | null) ?? null,
  }));
}

async function toDeletedCardNodes(
  db: Queryable,
  cardId: string,
  nodes: SubtreeNodeRow[]
): Promise<DeletedCardNodes> {
  const cardNodes = nodes.filter((node) => node.card_id === cardId);
  // A deleted card has every node inside the subtrees. Several nodes can share
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
  const rows = await selectSubtreeNodes(db, rootNodeIds);
  const remainingSymlinks = await selectRemainingSymlinks(db, rootNodeIds);

  const nodes = new Map<string, SubtreeNodeRow>();
  for (const row of rows) if (!nodes.has(row.id)) nodes.set(row.id, row);
  const subtreeNodes = [...nodes.values()];

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
    deletedCards,
    remainingSymlinks,
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
  const plan = await planTreeDeletion(db, target);
  if (!plan) return { deleted: false, rootNode: null, deletedCards: [], deletedNodeCount: 0 };

  const requestedCardId = "cardId" in target ? target.cardId : null;
  const deleted = "nodeId" in target
    ? await deleteNodeById(db, target.nodeId)
    : await deleteCardById(db, target.cardId);
  if (!deleted) {
    return { deleted: false, rootNode: plan.rootNode, deletedCards: [], deletedNodeCount: 0 };
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
  };
}
