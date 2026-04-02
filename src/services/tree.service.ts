import { getPool } from "../db/client.js";
import {
  selectNodeById,
  selectChildren,
  selectCanonicalNodeByCardId,
  deleteNodeById,
  insertNode,
  moveNode as moveNodeQuery,
} from "../db/queries/tree.js";
import { selectCardById } from "../db/queries/cards.js";
import { compileNode, type CompileOptions } from "../shared/bfs.js";
import type { Card, TreeNode, TreeNodeWithCard } from "../shared/types.js";
import { eventBus } from "../events/eventBus.js";

export async function getNode(nodeId: string): Promise<TreeNodeWithCard | null> {
  const db = getPool();
  const node = await selectNodeById(db, nodeId);
  if (!node) return null;
  const card = await selectCardById(db, node.card_id);
  if (!card) return null;
  return { ...node, card };
}

export async function listChildren(
  parentNodeId: string | null
): Promise<TreeNodeWithCard[]> {
  const db = getPool();
  const nodes = await selectChildren(db, parentNodeId);
  const results: TreeNodeWithCard[] = [];
  for (const node of nodes) {
    const card = await selectCardById(db, node.card_id);
    if (card) results.push({ ...node, card });
  }
  return results;
}

export async function compileSubtree(
  nodeId: string,
  depth: number = 2,
  options: CompileOptions = {}
): Promise<string> {
  const db = getPool();

  // Cache nodes and cards fetched during this compile to avoid repeated DB calls
  const nodeCache = new Map<string, TreeNode>();
  const cardCache = new Map<string, Card>();
  // Track visited card_ids to prevent infinite loops caused by symlink cycles
  const visitedCardIds = new Set<string>();

  async function preloadSubtree(nid: string, remaining: number): Promise<void> {
    const node = await selectNodeById(db, nid);
    if (!node) return;
    nodeCache.set(nid, node);
    if (!cardCache.has(node.card_id)) {
      const card = await selectCardById(db, node.card_id);
      if (card) cardCache.set(node.card_id, card);
    }

    if (remaining <= 0) return;

    // Cycle detection: skip if this card_id was already visited in the current path
    if (visitedCardIds.has(node.card_id)) return;
    visitedCardIds.add(node.card_id);

    // For symlinks, also load canonical node's children
    const childParentId = node.is_symlink
      ? (await selectCanonicalNodeByCardId(db, node.card_id))?.id ?? nid
      : nid;

    const children = await selectChildren(db, childParentId);
    for (const child of children) {
      nodeCache.set(child.id, child);
      if (!cardCache.has(child.card_id)) {
        const card = await selectCardById(db, child.card_id);
        if (card) cardCache.set(child.card_id, card);
      }
      await preloadSubtree(child.id, remaining - 1);
    }

    visitedCardIds.delete(node.card_id);
  }

  await preloadSubtree(nodeId, depth);

  function getNodeCard(nid: string): { card_id: string; is_symlink: boolean } {
    const node = nodeCache.get(nid);
    if (!node) throw new Error(`Node not found: ${nid}`);
    return { card_id: node.card_id, is_symlink: node.is_symlink };
  }

  function getChildrenSync(nid: string): TreeNode[] {
    const node = nodeCache.get(nid);
    if (!node) return [];

    // If symlink, return canonical node's children
    const effectiveParentId = node.is_symlink
      ? findCanonicalNodeId(node.card_id) ?? nid
      : nid;

    return Array.from(nodeCache.values()).filter(
      (n) => n.parent_node_id === effectiveParentId
    ).sort((a, b) => a.position - b.position);
  }

  function findCanonicalNodeId(card_id: string): string | null {
    for (const [id, n] of nodeCache) {
      if (n.card_id === card_id && !n.is_symlink) return id;
    }
    return null;
  }

  function getCardSync(card_id: string): Card {
    const card = cardCache.get(card_id);
    if (!card) throw new Error(`Card not found: ${card_id}`);
    return card;
  }

  return compileNode(nodeId, getNodeCard, getChildrenSync, getCardSync, depth, new Set(), 1, options);
}

export async function createSymlink(
  card_id: string,
  parent_node_id: string | null,
  position?: number
): Promise<TreeNode> {
  const node = await insertNode(getPool(), card_id, parent_node_id, position, true);
  eventBus.emit("atom:event", {
    type: "node:created",
    nodeId: node.id,
    cardId: card_id,
    parentNodeId: parent_node_id,
  });
  return node;
}

export async function deleteNode(nodeId: string): Promise<boolean> {
  const deleted = await deleteNodeById(getPool(), nodeId);
  if (deleted) {
    eventBus.emit("atom:event", { type: "node:deleted", nodeId });
  }
  return deleted;
}

export async function moveNode(
  nodeId: string,
  new_parent_node_id: string | null,
  new_position?: number
): Promise<TreeNode | null> {
  const node = await moveNodeQuery(getPool(), nodeId, new_parent_node_id, new_position);
  if (node) {
    eventBus.emit("atom:event", {
      type: "node:moved",
      nodeId,
      newParentNodeId: new_parent_node_id,
    });
  }
  return node;
}
