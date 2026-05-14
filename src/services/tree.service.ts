import { getDb } from "../db/client.js";
import {
  selectNodeById,
  selectChildren,
  selectCanonicalNodeByCardId,
  deleteNodeById,
  insertNode,
  moveNode as moveNodeQuery,
  getNodeBreadcrumb,
  updateNodeProperties as updateNodePropertiesQuery,
} from "../db/queries/tree.js";
import { selectCardById, updateCardSnapshot, updateCardSourceType } from "../db/queries/cards.js";
import { compileNode, type CompileOptions, type ResolvedRef } from "../shared/bfs.js";
import type { Card, TreeNode, TreeNodeWithCard } from "../shared/types.js";
import type { Queryable } from "../db/queryable.js";
import type { UnfurlCredentials } from "../unfurl/interface.js";
import { adapterRegistry } from "../unfurl/registry.js";
import { parseSnapshot } from "../unfurl/utils.js";
import { eventBus } from "../events/eventBus.js";
import { posToKey, keyToPos, keyBetween, rekeyEvenly, NORMAL_DIGIT_COUNT } from "../shared/lexorank.js";

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
  const db = getDb();
  const node = await selectNodeById(db, nodeId);
  if (!node) return null;
  const card = await selectCardById(db, node.card_id);
  if (!card) return null;
  return { ...node, card };
}

export async function listChildren(
  parentNodeId: string | null
): Promise<TreeNodeWithCard[]> {
  const db = getDb();

  // symlink 해석: 부모가 symlink이면 canonical node의 자식을 반환
  let effectiveParentId = parentNodeId;
  if (parentNodeId !== null) {
    const parentNode = await selectNodeById(db, parentNodeId);
    if (parentNode?.is_symlink) {
      const canonicalNode = await selectCanonicalNodeByCardId(db, parentNode.card_id);
      if (canonicalNode) {
        effectiveParentId = canonicalNode.id;
      }
    }
  }

  const nodes = await selectChildren(db, effectiveParentId);
  const results: TreeNodeWithCard[] = [];
  for (const node of nodes) {
    const card = await selectCardById(db, node.card_id);
    if (!card) continue;
    if (!node.is_symlink) {
      results.push({ ...node, card });
      continue;
    }
    // symlink: canonical 노드의 breadcrumb을 canonical_path로 첨부
    const canonical = await selectCanonicalNodeByCardId(db, node.card_id);
    if (!canonical) {
      results.push({ ...node, card }); // orphan symlink
      continue;
    }
    const parts = await getNodeBreadcrumb(db, canonical.id);
    results.push({ ...node, card, canonical_path: parts.join(' / ') });
  }
  return results;
}

async function resolveRefs(
  cardCache: Map<string, Card>,
  mode: "cached" | "fresh",
  credentials: Record<string, UnfurlCredentials>
): Promise<Map<string, ResolvedRef>> {
  const db = getDb();
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
        resolved.set(cardId, { ok: false, error: serializeError(e), sourceType: card.source_type });
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
  depth: number = 3,
  options: CompileOptions = {},
  resolveRefsMode?: false | "cached" | "fresh",
  credentials?: Record<string, UnfurlCredentials>
): Promise<CompileResult> {
  const db = getDb();

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
    let childParentId = nid;
    if (node.is_symlink) {
      const canonicalNode = await selectCanonicalNodeByCardId(db, node.card_id);
      if (canonicalNode) {
        // canonical node 자체도 캐시에 추가 — findCanonicalNodeId가 찾을 수 있도록
        nodeCache.set(canonicalNode.id, canonicalNode);
        if (!cardCache.has(canonicalNode.card_id)) {
          const canonicalCard = await selectCardById(db, canonicalNode.card_id);
          if (canonicalCard) cardCache.set(canonicalNode.card_id, canonicalCard);
        }
        childParentId = canonicalNode.id;
      }
    }

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

    const children = Array.from(nodeCache.values())
      .filter((n) => n.parent_node_id === effectiveParentId)
      .sort((a, b) => (a.position - b.position) || a.id.localeCompare(b.id));

    const jl = node.journal_limit;
    if (jl === null || jl === undefined) return children;
    // position 역순(최신 우선)으로 정렬 후 N개 선택, 다시 position 오름차순으로 반환.
    // Cycle A1: tie-break by id (descending in reverse-sort, ascending in final).
    // Matches SQL `ORDER BY position, id ASC` (queries/tree.ts selectChildren).
    const byPosition = [...children].sort((a, b) => (b.position - a.position) || b.id.localeCompare(a.id));
    const limited = jl === 0 ? byPosition : byPosition.slice(0, jl);
    return limited.sort((a, b) => (a.position - b.position) || a.id.localeCompare(b.id));
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
  const node = await insertNode(getDb(), card_id, parent_node_id, position, true);
  eventBus.emit("atom:event", {
    type: "node:created",
    nodeId: node.id,
    cardId: card_id,
    parentNodeId: parent_node_id,
  });
  return node;
}

export async function deleteNode(nodeId: string): Promise<boolean> {
  const deleted = await deleteNodeById(getDb(), nodeId);
  if (deleted) {
    eventBus.emit("atom:event", { type: "node:deleted", nodeId });
  }
  return deleted;
}

// ---------------------------------------------------------------------------
// Relative position resolution (cycle B)
// ---------------------------------------------------------------------------

export interface MoveNodeOptions {
  /** Destination parent. undefined = keep current, null = root. */
  parent_node_id?: string | null;
  /** @deprecated Use before/after/to. Absolute position (still works). */
  position?: number;
  /** Place before this sibling node_id. */
  before?: string;
  /** Place after this sibling node_id. */
  after?: string;
  /** Place at start or end of parent's children. */
  to?: "start" | "end";
}

/**
 * Resolve a relative or absolute position specifier into a normal-territory
 * LexoRank key string. If keyBetween would produce a fractional key (the
 * gap between two adjacent siblings is too narrow), this function rekeys
 * all siblings under the parent to make room — the DB always stays in the
 * 10-digit normal territory so `keyToPos` and the `position: number`
 * response continue to work.
 */
export async function resolvePositionKey(
  db: Queryable,
  parentNodeId: string | null,
  selfNodeId: string | null,
  opts: { before?: string; after?: string; to?: "start" | "end"; position?: number }
): Promise<{ key: string; warnings: string[] }> {
  const warnings: string[] = [];

  // Mutual exclusivity
  const specifiers = [opts.before, opts.after, opts.to, opts.position].filter(
    (v) => v !== undefined
  );
  if (specifiers.length > 1) {
    throw new Error(
      "move_node: only one of before, after, to, or position may be specified"
    );
  }

  // Deprecated absolute position
  if (opts.position !== undefined) {
    if (opts.position < 0) {
      throw new Error(
        `move_node: position must be non-negative, got ${opts.position}`
      );
    }
    warnings.push(
      "position is deprecated; use before, after, or to instead"
    );
    return { key: posToKey(opts.position), warnings };
  }

  // Relative positioning
  if (opts.before || opts.after || opts.to) {
    const allSiblings = await selectChildren(db, parentNodeId);

    // Validate before/after target BEFORE self-exclusion (otherwise a
    // non-existent sibling can be masked by the empty-array shortcut).
    if (opts.before) {
      if (!allSiblings.some((s) => s.id === opts.before)) {
        throw new Error(
          `move_node: before node '${opts.before}' not found among siblings of parent`
        );
      }
    }
    if (opts.after) {
      if (!allSiblings.some((s) => s.id === opts.after)) {
        throw new Error(
          `move_node: after node '${opts.after}' not found among siblings of parent`
        );
      }
    }

    const siblings = selfNodeId
      ? allSiblings.filter((s) => s.id !== selfNodeId)
      : allSiblings;

    // Self was the only child — just assign a default key
    if (siblings.length === 0) {
      return { key: posToKey(100), warnings };
    }

    let insertionIndex: number;

    if (opts.before) {
      insertionIndex = siblings.findIndex((s) => s.id === opts.before);
      // Target is self (before self) — treat as no-op position
      if (insertionIndex < 0) {
        const selfIdx = allSiblings.findIndex((s) => s.id === selfNodeId);
        return { key: posToKey(allSiblings[selfIdx].position), warnings };
      }
    } else if (opts.after) {
      const afterIdx = siblings.findIndex((s) => s.id === opts.after);
      // Target is self (after self) — treat as no-op position
      if (afterIdx < 0) {
        const selfIdx = allSiblings.findIndex((s) => s.id === selfNodeId);
        return { key: posToKey(allSiblings[selfIdx].position), warnings };
      }
      insertionIndex = afterIdx + 1;
    } else if (opts.to === "start") {
      insertionIndex = 0;
    } else {
      // to === "end"
      insertionIndex = siblings.length;
    }

    const prevKey =
      insertionIndex > 0
        ? posToKey(siblings[insertionIndex - 1].position)
        : null;
    const nextKey =
      insertionIndex < siblings.length
        ? posToKey(siblings[insertionIndex].position)
        : null;

    let key: string;
    try {
      key = keyBetween(prevKey, nextKey);
    } catch {
      // Adjacent keys or zero-boundary — rekey all siblings to make room
      key = await rekeyAndInsert(db, parentNodeId, siblings, insertionIndex);
      return { key, warnings };
    }

    if (key.length > NORMAL_DIGIT_COUNT) {
      // Fractional key would break keyToPos → rekey siblings
      key = await rekeyAndInsert(db, parentNodeId, siblings, insertionIndex);
    }

    return { key, warnings };
  }

  // Default: append to end (same as pre-cycle-B behavior)
  const maxResult = await db.query(
    `SELECT COALESCE(MAX(position), '0000000000') AS max_pos
     FROM tree_nodes
     WHERE parent_node_id IS NOT DISTINCT FROM $1${selfNodeId ? " AND id != $2" : ""}`,
    selfNodeId ? [parentNodeId, selfNodeId] : [parentNodeId]
  );
  const maxNumeric = keyToPos(maxResult.rows[0]["max_pos"] as string);
  return { key: posToKey(maxNumeric + 100), warnings };
}

/**
 * Rekey all siblings under a parent to make room for an insertion at
 * `insertionIndex`. Returns the key assigned to the new insertion slot.
 */
async function rekeyAndInsert(
  db: Queryable,
  parentNodeId: string | null,
  currentSiblings: TreeNode[],
  insertionIndex: number
): Promise<string> {
  const totalCount = currentSiblings.length + 1;
  const keys = rekeyEvenly(totalCount);

  let keyIdx = 0;
  for (let i = 0; i < currentSiblings.length; i++) {
    if (keyIdx === insertionIndex) keyIdx++; // skip the slot for the new node
    await db.query(
      `UPDATE tree_nodes SET position = $1 WHERE id = $2`,
      [keys[keyIdx], currentSiblings[i].id]
    );
    keyIdx++;
  }

  return keys[insertionIndex];
}

export async function moveNode(
  nodeId: string,
  opts: MoveNodeOptions
): Promise<{ node: TreeNode | null; warnings: string[] }> {
  const db = getDb();

  // Resolve parent: undefined = keep current, null = root
  let effectiveParent: string | null;
  if (opts.parent_node_id === undefined) {
    const currentNode = await selectNodeById(db, nodeId);
    if (!currentNode) return { node: null, warnings: [] };
    effectiveParent = currentNode.parent_node_id;
  } else {
    effectiveParent = opts.parent_node_id;
  }

  // Resolve position key
  const { key, warnings } = await resolvePositionKey(db, effectiveParent, nodeId, {
    before: opts.before,
    after: opts.after,
    to: opts.to,
    position: opts.position,
  });

  const node = await moveNodeQuery(db, nodeId, effectiveParent, key);
  if (node) {
    eventBus.emit("atom:event", {
      type: "node:moved",
      nodeId,
      newParentNodeId: effectiveParent,
    });
  }

  return { node, warnings };
}

/**
 * Update tree-node properties (journal_limit, etc.).
 *
 * Symlink policy: symlink nodes are NOT redirected to their canonical node.
 * A symlink stores its own journal_limit which is referenced by
 * getChildrenSync (see tree.service.ts:222 equivalent in compile path)
 * when compile_subtree descends into that node. This lets the same card
 * appear under multiple parents with different per-parent limits.
 *
 * Emits `node:updated` on success. The batch_op.node_updates path calls the
 * underlying DB query directly and does NOT emit this per-node event —
 * the aggregate `batch:completed` event covers batch consumers. This is
 * consistent with other batch operations (updates/moves/deletes/symlinks).
 */
export async function updateNodeProperties(
  nodeId: string,
  props: { journal_limit?: number | null }
): Promise<TreeNode | null> {
  // The DB layer is the canonical guard for partial-update semantics
  // (see `updateNodeProperties` in `db/queries/tree.ts`): it returns
  // `updated=false` when no provided field triggered an UPDATE. We trust
  // that flag rather than re-deriving it from `props` here, so adding a
  // new updatable column requires changes in exactly one place.
  const { node, updated } = await updateNodePropertiesQuery(getDb(), nodeId, props);
  if (node && updated) {
    eventBus.emit("atom:event", { type: "node:updated", nodeId });
  }
  return node;
}
