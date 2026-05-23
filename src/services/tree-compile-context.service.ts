import {
  selectCanonicalNodeByCardId,
  selectChildren,
  selectNodeById,
} from "../db/queries/tree.js";
import { selectCardById } from "../db/queries/cards.js";
import type { Queryable } from "../db/queryable.js";
import type { Card, TreeNode } from "../shared/types.js";

export interface TreeCompileContext {
  readonly cardCache: ReadonlyMap<string, Card>;
  getNodeCard(nodeId: string): { card_id: string; is_symlink: boolean };
  getChildren(nodeId: string): TreeNode[];
  getCard(cardId: string): Card;
}

export async function loadTreeCompileContext(
  db: Queryable,
  nodeId: string,
  depth: number
): Promise<TreeCompileContext> {
  const nodeCache = new Map<string, TreeNode>();
  const cardCache = new Map<string, Card>();
  const visitedCardIds = new Set<string>();

  async function preloadSubtree(nid: string, remaining: number): Promise<void> {
    const node = await selectNodeById(db, nid);
    if (!node) return;
    nodeCache.set(nid, node);
    await cacheCard(db, cardCache, node.card_id);

    if (remaining <= 0) return;
    if (visitedCardIds.has(node.card_id)) return;

    visitedCardIds.add(node.card_id);
    try {
      const childParentId = await resolveChildParentId(db, nodeCache, cardCache, node);
      const children = await selectChildren(db, childParentId);
      for (const child of children) {
        nodeCache.set(child.id, child);
        await cacheCard(db, cardCache, child.card_id);
        await preloadSubtree(child.id, remaining - 1);
      }
    } finally {
      visitedCardIds.delete(node.card_id);
    }
  }

  await preloadSubtree(nodeId, depth);

  return {
    cardCache,
    getNodeCard(nid) {
      const node = nodeCache.get(nid);
      if (!node) throw new Error(`Node not found: ${nid}`);
      return { card_id: node.card_id, is_symlink: node.is_symlink };
    },
    getChildren(nid) {
      const node = nodeCache.get(nid);
      if (!node) return [];

      const effectiveParentId = node.is_symlink
        ? findCanonicalNodeId(nodeCache, node.card_id) ?? nid
        : nid;

      const children = Array.from(nodeCache.values())
        .filter((n) => n.parent_node_id === effectiveParentId)
        .sort(compareTreePositionAsc);

      const journalLimit = node.journal_limit;
      if (journalLimit === null || journalLimit === undefined) return children;

      const newestChildren = [...children].sort(compareTreePositionDesc);
      const limited = journalLimit === 0 ? newestChildren : newestChildren.slice(0, journalLimit);
      return limited.sort(compareTreePositionAsc);
    },
    getCard(cardId) {
      const card = cardCache.get(cardId);
      if (!card) throw new Error(`Card not found: ${cardId}`);
      return card;
    },
  };
}

async function resolveChildParentId(
  db: Queryable,
  nodeCache: Map<string, TreeNode>,
  cardCache: Map<string, Card>,
  node: TreeNode
): Promise<string> {
  if (!node.is_symlink) return node.id;

  const canonicalNode = await selectCanonicalNodeByCardId(db, node.card_id);
  if (!canonicalNode) return node.id;

  nodeCache.set(canonicalNode.id, canonicalNode);
  await cacheCard(db, cardCache, canonicalNode.card_id);
  return canonicalNode.id;
}

async function cacheCard(
  db: Queryable,
  cardCache: Map<string, Card>,
  cardId: string
): Promise<void> {
  if (cardCache.has(cardId)) return;
  const card = await selectCardById(db, cardId);
  if (card) cardCache.set(cardId, card);
}

function findCanonicalNodeId(nodeCache: ReadonlyMap<string, TreeNode>, cardId: string): string | null {
  for (const [id, node] of nodeCache) {
    if (node.card_id === cardId && !node.is_symlink) return id;
  }
  return null;
}

function compareTreePositionAsc(a: TreeNode, b: TreeNode): number {
  return a.position - b.position || a.id.localeCompare(b.id);
}

function compareTreePositionDesc(a: TreeNode, b: TreeNode): number {
  return b.position - a.position || b.id.localeCompare(a.id);
}
