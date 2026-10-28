import {
  selectCanonicalNodesByCardIds,
  selectChildrenByParentIds,
  selectNodeById,
} from "../db/queries/tree.js";
import { selectCardsByIds } from "../db/queries/cards.js";
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
  const canonicalNodeIdByCardId = new Map<string, string>();
  const canonicalLookupComplete = new Set<string>();
  const fetchedParentIds = new Set<string>();

  function cacheNodes(nodes: TreeNode[]): void {
    for (const node of nodes) {
      nodeCache.set(node.id, node);
      if (!node.is_symlink && !canonicalNodeIdByCardId.has(node.card_id)) {
        canonicalNodeIdByCardId.set(node.card_id, node.id);
        canonicalLookupComplete.add(node.card_id);
      }
    }
  }

  async function cacheMissingCards(cardIds: string[]): Promise<void> {
    const missingCardIds = Array.from(new Set(cardIds)).filter((id) => !cardCache.has(id));
    if (missingCardIds.length === 0) return;
    const cards = await selectCardsByIds(db, missingCardIds);
    for (const card of cards) cardCache.set(card.id, card);
  }

  const root = await selectNodeById(db, nodeId);
  if (root) {
    cacheNodes([root]);
    await cacheMissingCards([root.card_id]);
  }

  let levelNodes = root ? [root] : [];
  let level = 0;

  // Match the compiler's remaining-depth check, including NaN from agent REST.
  while (levelNodes.length > 0 && !(depth - level <= 0)) {
    const unresolvedCardIds = Array.from(new Set(
      levelNodes
        .filter((node) => node.is_symlink && !canonicalLookupComplete.has(node.card_id))
        .map((node) => node.card_id)
    ));
    const canonicalNodes = unresolvedCardIds.length > 0
      ? await selectCanonicalNodesByCardIds(db, unresolvedCardIds)
      : [];
    cacheNodes(canonicalNodes);
    for (const cardId of unresolvedCardIds) canonicalLookupComplete.add(cardId);

    const parentIds = Array.from(new Set(levelNodes.map((node) =>
      node.is_symlink
        ? canonicalNodeIdByCardId.get(node.card_id) ?? node.id
        : node.id
    )));
    const newParentIds = parentIds.filter((parentId) => !fetchedParentIds.has(parentId));
    const childNodes = newParentIds.length > 0
      ? await selectChildrenByParentIds(db, newParentIds)
      : [];
    for (const parentId of newParentIds) fetchedParentIds.add(parentId);
    cacheNodes(childNodes);
    await cacheMissingCards([
      ...canonicalNodes.map((node) => node.card_id),
      ...childNodes.map((node) => node.card_id),
    ]);

    if (childNodes.length === 0) break;
    levelNodes = childNodes;
    level += 1;
  }

  const childrenByParent = new Map<string, TreeNode[]>();
  for (const node of nodeCache.values()) {
    if (node.parent_node_id === null) continue;
    const children = childrenByParent.get(node.parent_node_id) ?? [];
    children.push(node);
    childrenByParent.set(node.parent_node_id, children);
  }
  for (const children of childrenByParent.values()) children.sort(compareTreePositionAsc);

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
        ? canonicalNodeIdByCardId.get(node.card_id) ?? nid
        : nid;
      const children = childrenByParent.get(effectiveParentId) ?? [];
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

function compareTreePositionAsc(a: TreeNode, b: TreeNode): number {
  return a.position - b.position || a.id.localeCompare(b.id);
}

function compareTreePositionDesc(a: TreeNode, b: TreeNode): number {
  return b.position - a.position || b.id.localeCompare(a.id);
}
