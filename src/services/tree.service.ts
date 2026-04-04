import { getPool } from "../db/client.js";
import {
  selectNodeById,
  selectChildren,
  selectCanonicalNodeByCardId,
  deleteNodeById,
  insertNode,
  moveNode as moveNodeQuery,
} from "../db/queries/tree.js";
import { selectCardById, updateCardSnapshot, updateCardSourceType } from "../db/queries/cards.js";
import { compileNode, type CompileOptions, type ResolvedRef } from "../shared/bfs.js";
import type { Card, TreeNode, TreeNodeWithCard } from "../shared/types.js";
import type { UnfurlCredentials } from "../unfurl/interface.js";
import { adapterRegistry } from "../unfurl/registry.js";
import { parseSnapshot } from "../unfurl/utils.js";
import { eventBus } from "../events/eventBus.js";

function serializeError(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  try {
    const json = JSON.stringify(e);
    return json !== '{}' ? json : String(e);
  } catch {
    return String(e);
  }
}

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

async function resolveRefs(
  cardCache: Map<string, Card>,
  mode: "cached" | "fresh",
  credentials: Record<string, UnfurlCredentials>
): Promise<Map<string, ResolvedRef>> {
  const db = getPool();
  const resolved = new Map<string, ResolvedRef>();
  await Promise.allSettled(
    Array.from(cardCache.entries()).map(async ([cardId, card]) => {
      if (!card.source_ref || !card.source_type) return;
      const adapter =
        adapterRegistry.find(card.source_type) ??
        adapterRegistry.findByRef(card.source_ref);
      if (!adapter) return; // 어댑터 없으면 skip

      // source_type 미스매치: fallback으로 찾은 경우 자동 수복 (fire-and-forget)
      if (!adapterRegistry.find(card.source_type)) {
        updateCardSourceType(db, cardId, adapter.sourceType).catch((e) =>
          console.error("[unfurl] source_type repair failed", e)
        );
      }

      const creds = credentials[adapter.sourceType] ?? {};

      if (mode === "cached" && card.source_snapshot) {
        // 캐시 히트: snapshot을 파싱하여 재사용
        try {
          const result = parseSnapshot(card.source_snapshot);
          resolved.set(cardId, { ok: true, result, sourceType: card.source_type });
        } catch (e) {
          resolved.set(cardId, { ok: false, error: serializeError(e), sourceType: card.source_type });
        }
        return;
      }

      // 캐시 미스 또는 'fresh' 모드: adapter.resolve() 호출
      try {
        const result = await adapter.resolve(card.source_ref, creds);
        resolved.set(cardId, { ok: true, result, sourceType: card.source_type });
        // fire-and-forget: snapshot write-back
        updateCardSnapshot(db, cardId, result.snapshot).catch((e) =>
          console.error("[unfurl] snapshot write failed", e)
        );
      } catch (e) {
        resolved.set(cardId, { ok: false, error: String(e), sourceType: card.source_type });
      }
    })
  );
  return resolved;
}

export interface CompileResult {
  markdown: string;
  unfurls?: Record<string, { ok: boolean; data?: Record<string, unknown> | null; error?: string; sourceType: string }>;
}

export async function compileSubtree(
  nodeId: string,
  depth: number = 2,
  options: CompileOptions = {},
  resolveRefsMode?: false | "cached" | "fresh",
  credentials?: Record<string, UnfurlCredentials>
): Promise<CompileResult> {
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

  let resolvedRefsMap: Map<string, ResolvedRef> | undefined;
  if (resolveRefsMode !== undefined && resolveRefsMode !== false) {
    resolvedRefsMap = await resolveRefs(
      cardCache,
      resolveRefsMode,
      credentials ?? {}
    );
    options = { ...options, resolvedRefs: resolvedRefsMap };
  }

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

  let markdown = compileNode(nodeId, getNodeCard, getChildrenSync, getCardSync, depth, new Set(), 1, options);

  // max_chars post-processing
  if (options.maxChars && options.maxChars > 0 && markdown.length > options.maxChars) {
    const truncated = markdown.slice(0, options.maxChars);
    const lastNewline = truncated.lastIndexOf("\n");
    const cleanCut = lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated;
    const omittedChars = markdown.length - cleanCut.length;
    markdown = cleanCut + `\n<!-- truncated: ${omittedChars} chars omitted -->`;
  }

  // Build unfurls map: cardId → {ok, data, error, sourceType}
  let unfurls: CompileResult["unfurls"] | undefined;
  if (resolvedRefsMap && resolvedRefsMap.size > 0) {
    unfurls = {};
    for (const [cardId, resolved] of resolvedRefsMap.entries()) {
      if (resolved.ok) {
        unfurls[cardId] = {
          ok: true,
          data: resolved.result.unfurlData,
          sourceType: resolved.sourceType,
        };
      } else {
        unfurls[cardId] = {
          ok: false,
          error: resolved.error,
          sourceType: resolved.sourceType,
        };
      }
    }
  }

  return { markdown, ...(unfurls ? { unfurls } : {}) };
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
