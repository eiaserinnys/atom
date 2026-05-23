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
import { selectCardById } from "../db/queries/cards.js";
import { compileNode, type CompileOptions, type ResolvedRef } from "../shared/bfs.js";
import type { TreeNode, TreeNodeWithCard } from "../shared/types.js";
import type { UnfurlCredentials } from "../unfurl/interface.js";
import { eventBus } from "../events/eventBus.js";
import { selectChildrenWithCards, toTreeNodeWithCard } from "./tree-node-payload.js";
import { resolvePositionKey, type MoveNodeOptions } from "./tree-position.service.js";
import {
  buildCompileUnfurls,
  createCompileUnfurlDeps,
  resolveCompileRefs,
  type CompileUnfurls,
} from "./compile-unfurl.service.js";
import { loadTreeCompileContext } from "./tree-compile-context.service.js";

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

export interface CompileResult {
  markdown: string;
  unfurls?: CompileUnfurls;
}

export async function compileSubtree(
  nodeId: string,
  depth: number = 3,
  options: CompileOptions = {},
  resolveRefsMode?: false | "cached" | "fresh",
  credentials?: Record<string, UnfurlCredentials>
): Promise<CompileResult> {
  const db = getDb();
  const compileContext = await loadTreeCompileContext(db, nodeId, depth);

  let resolvedRefsMap: Map<string, ResolvedRef> | undefined;
  if (resolveRefsMode !== undefined && resolveRefsMode !== false) {
    resolvedRefsMap = await resolveCompileRefs(
      compileContext.cardCache,
      resolveRefsMode,
      credentials ?? {},
      createCompileUnfurlDeps(db)
    );
    options = { ...options, resolvedRefs: resolvedRefsMap };
  }

  let markdown = compileNode(
    nodeId,
    compileContext.getNodeCard,
    compileContext.getChildren,
    compileContext.getCard,
    depth,
    new Set(),
    1,
    options
  );

  // max_chars post-processing
  if (options.maxChars && options.maxChars > 0 && markdown.length > options.maxChars) {
    const truncated = markdown.slice(0, options.maxChars);
    const lastNewline = truncated.lastIndexOf("\n");
    const cleanCut = lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated;
    const omittedChars = markdown.length - cleanCut.length;
    markdown = cleanCut + `\n<!-- truncated: ${omittedChars} chars omitted -->`;
  }

  const unfurls = buildCompileUnfurls(resolvedRefsMap);

  return { markdown, ...(unfurls ? { unfurls } : {}) };
}

export async function createSymlink(
  card_id: string,
  parent_node_id: string | null,
  position?: number
): Promise<TreeNode> {
  const db = getDb();
  const node = await insertNode(db, card_id, parent_node_id, position, true);
  eventBus.emit("atom:event", {
    type: "node:created",
    nodeId: node.id,
    cardId: card_id,
    parentNodeId: parent_node_id,
    node: await toTreeNodeWithCard(db, node),
    actor: null,
  });
  return node;
}

export async function deleteNode(nodeId: string): Promise<boolean> {
  const db = getDb();
  const node = await selectNodeById(db, nodeId);
  const deleted = await deleteNodeById(db, nodeId);
  if (deleted) {
    eventBus.emit("atom:event", {
      type: "node:deleted",
      nodeId,
      cardId: node?.card_id ?? "",
      parentNodeId: node?.parent_node_id ?? null,
      actor: null,
    });
  }
  return deleted;
}

export async function moveNode(
  nodeId: string,
  opts: MoveNodeOptions
): Promise<{ node: TreeNode | null; warnings: string[] }> {
  const db = getDb();
  const oldNode = await selectNodeById(db, nodeId);
  if (!oldNode) return { node: null, warnings: [] };

  // Resolve parent: undefined = keep current, null = root
  let effectiveParent: string | null;
  if (opts.parent_node_id === undefined) {
    effectiveParent = oldNode.parent_node_id;
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
      oldParentNodeId: oldNode.parent_node_id,
      newParentNodeId: effectiveParent,
      node: await toTreeNodeWithCard(db, node),
      affectedNodes: await selectChildrenWithCards(db, effectiveParent),
      actor: null,
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
  const db = getDb();
  const { node, updated } = await updateNodePropertiesQuery(db, nodeId, props);
  if (node && updated) {
    eventBus.emit("atom:event", {
      type: "node:updated",
      nodeId,
      node: await toTreeNodeWithCard(db, node),
      actor: null,
    });
  }
  return node;
}
