import type { Card, TreeNode } from "./types.js";

export interface CompileOptions {
  includeIds?: boolean;
  titlesOnly?: boolean;
  numbering?: boolean;
  maxChars?: number;
  excludeNodes?: Set<string>; // node_id Set
}

function buildMetaComment(
  nodeId: string,
  card: Card,
  depth: number,
  chars?: number,
  isSymlink?: boolean
): string {
  const parts = [`node:${nodeId}`, `card:${card.id}`, `depth:${depth}`];
  if (card.card_timestamp) {
    const ts = typeof card.card_timestamp === "string"
      ? card.card_timestamp
      : new Date(card.card_timestamp).toISOString();
    parts.push(`created:${ts.slice(0, 10)}`);
  }
  if (card.staleness === "stale" || card.staleness === "outdated") {
    parts.push(`stale:${card.staleness}`);
  }
  if (card.source_type) {
    parts.push(`source:${card.source_type}`);
  }
  if (chars !== undefined) {
    parts.push(`chars:${chars}`);
  }
  if (isSymlink) {
    parts.push("symlink:true");
  }
  return `<!-- ${parts.join(" ")} -->`;
}

/**
 * BFS+N subtree compiler.
 *
 * Pure function — no DB access. Children and card data are fetched via callbacks.
 *
 * @param nodeId     Starting tree node ID
 * @param getChildren Returns direct children of a node ID
 * @param getCard    Returns the card for a given card_id
 * @param depth      How many levels to expand.
 *                   0 = current node only (no children expanded)
 *                   1 = current + direct children
 *                   N = N levels
 *                   Infinity / Number.MAX_SAFE_INTEGER = full tree
 * @param visited    Set of card_ids already visited in this traversal (cycle detection)
 * @param headingLevel Markdown heading level for the current node (starts at 1)
 */
export function compile(
  nodeId: string,
  getChildren: (id: string) => TreeNode[],
  getCard: (cardId: string) => Card,
  depth: number,
  visited: Set<string> = new Set(),
  headingLevel: number = 1
): string {
  const node = getChildren(nodeId).find(() => true); // locate this node by looking it up via parent
  // getCard is called by the caller before invoking compile — we receive the card directly
  // We redesign: accept the current node's card_id directly
  throw new Error("Use compileNode instead");
}

/**
 * Compile a subtree rooted at the given tree node.
 *
 * @param nodeId       The tree node to start from
 * @param getNodeCard  Returns {card_id, is_symlink} for a given node_id
 * @param getChildren  Returns child TreeNodes for a given node_id
 * @param getCard      Returns the Card for a given card_id
 * @param depth        Expansion depth (0 = node only, Infinity = full tree)
 * @param visited      Visited card_ids (for cycle detection in symlink expansion)
 * @param headingLevel Markdown heading level for this node
 * @param options      Compile options (includeIds: add HTML comments with metadata)
 */
export function compileNode(
  nodeId: string,
  getNodeCard: (nodeId: string) => { card_id: string; is_symlink: boolean },
  getChildren: (nodeId: string) => TreeNode[],
  getCard: (cardId: string) => Card,
  depth: number,
  visited: Set<string> = new Set(),
  headingLevel: number = 1,
  options: CompileOptions = {},
  numberPrefix: string = ""
): string {
  // exclude_nodes — skip this node and all descendants
  if (options.excludeNodes?.has(nodeId)) {
    return "";
  }

  const { card_id, is_symlink } = getNodeCard(nodeId);
  const currentDepth = headingLevel - 1; // root is depth 0
  const numberLabel = options.numbering && numberPrefix ? `${numberPrefix} ` : "";

  // Cycle detection — no metadata comment on cycle nodes
  if (visited.has(card_id)) {
    const card = getCard(card_id);
    if (options.titlesOnly) {
      const indent = "  ".repeat(currentDepth);
      const prefix = currentDepth === 0 ? "" : "├── ";
      return `${indent}${prefix}${numberLabel}${card.title} *(cycle)*`;
    }
    const heading = "#".repeat(Math.min(headingLevel, 6));
    return `${heading} ${numberLabel}${card.title} *(cycle)*`;
  }

  const card = getCard(card_id);
  const contentChars = card.content?.length ?? 0;

  // Build this node's output line
  const lines: string[] = [];
  if (options.titlesOnly) {
    const indent = "  ".repeat(currentDepth);
    const prefix = currentDepth === 0 ? "" : "├── ";
    const symlinkMark = is_symlink ? "~ " : "";
    const metaComment = options.includeIds
      ? " " + buildMetaComment(nodeId, card, currentDepth, contentChars, is_symlink)
      : ` (${contentChars} chars)`;
    lines.push(`${indent}${prefix}${numberLabel}${symlinkMark}${card.title}${metaComment}`);
  } else {
    const heading = "#".repeat(Math.min(headingLevel, 6));
    const symlinkMark = is_symlink ? "~ " : "";
    if (options.includeIds) {
      lines.push(`${heading} ${numberLabel}${symlinkMark}${card.title} ${buildMetaComment(nodeId, card, currentDepth, undefined, is_symlink)}`);
    } else {
      lines.push(`${heading} ${numberLabel}${symlinkMark}${card.title}`);
    }
    if (card.content) {
      lines.push(card.content);
    }
  }

  // No children if depth exhausted
  if (depth <= 0) {
    return lines.join("\n");
  }

  // For symlink nodes: expand via the canonical node (is_symlink=false) for this card_id
  // getChildren already handles this — it returns children of the node as stored in DB.
  // For symlinks, the caller (service layer) should pass a getChildren that looks up
  // canonical node children when is_symlink=true. Here bfs.ts is pure and trusts the callback.

  const newVisited = new Set(visited);
  newVisited.add(card_id);

  const children = getChildren(nodeId);

  children.forEach((child, idx) => {
    const childNumber = options.numbering
      ? numberPrefix
        ? `${numberPrefix}.${idx + 1}`
        : `${idx + 1}`
      : "";
    const childMarkdown = compileNode(
      child.id,
      getNodeCard,
      getChildren,
      getCard,
      depth - 1,
      newVisited,
      headingLevel + 1,
      options,
      childNumber
    );
    lines.push(childMarkdown);
  });

  return lines.join("\n");
}
