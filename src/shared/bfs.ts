import type { Card, TreeNode } from "./types.js";
import type { UnfurlResult } from "../unfurl/interface.js";
import { extractMarkdownHeadings, type MarkdownHeading } from "./compile-markdown-headings.js";

export type ResolvedRef =
  | { ok: true; result: UnfurlResult; sourceType: string }
  | { ok: false; error: string; sourceType: string };

export interface CompileOptions {
  /**
   * Tri-state ID/metadata exposure (260508 변경):
   *  - `undefined` (default) — ID-annotated output: short `[node:X card:Y]` label
   *    in titlesOnly mode, full HTML metadata comment in heading mode.
   *  - `true` — full HTML metadata comment in both modes.
   *  - `false` — minimal output (no IDs, pre-260508 legacy behavior).
   */
  includeIds?: boolean;
  titlesOnly?: boolean;
  numbering?: boolean;
  maxChars?: number;
  excludeNodes?: Set<string>; // node_id Set
  resolvedRefs?: Map<string, ResolvedRef>; // cardId → resolved
  /** Called when a non-cycle card body is emitted in full-content mode. */
  onCardEmitted?: (cardId: string) => void;
  /** Limit depth-1 children (direct children of the root node) to the latest n items.
   *  Sorted by card_timestamp descending. Does not affect deeper levels. */
  limit?: number;
  /** Children the node's journal_limit left out, so the output can say so. */
  getJournalOmission?: (nodeId: string) => JournalOmission | null;
}

export interface JournalOmission {
  count: number;
  journalLimit: number;
}

export interface CompileSection {
  index: number;
  node_id: string;
  card_id: string;
  card_version: number;
  depth: number;
  level: number;
  heading: string;
  title: string;
  cycle: boolean;
  chars: number;
  headings: MarkdownHeading[];
  content?: string | null;
  unfurl_text?: string | null;
}

function omissionNote(count: number, children: string, cause: string): string {
  return `<!-- omitted: ${count} ${children} (${cause}) -->`;
}

/**
 * The children to expand under a node, with one note line for each way they were cut:
 * the node's journal_limit, and the compile `limit` on the root's direct children.
 */
function selectChildren(
  nodeId: string,
  headingLevel: number,
  getNodeCard: (nodeId: string) => { card_id: string; is_symlink: boolean },
  getChildren: (nodeId: string) => TreeNode[],
  getCard: (cardId: string) => Card,
  options: CompileOptions
): { children: TreeNode[]; notes: string[] } {
  let children = getChildren(nodeId);
  const notes: string[] = [];

  const journal = options.getJournalOmission?.(nodeId);
  if (journal) {
    notes.push(omissionNote(
      journal.count,
      journal.count === 1 ? "older child" : "older children",
      `journal_limit ${journal.journalLimit}`
    ));
  }

  // The limit applies only to the root's direct children, newest card_timestamp first.
  const limit = headingLevel === 1 ? options.limit : undefined;
  if (limit !== undefined) {
    const omitted = children.length - limit;
    if (omitted > 0) {
      notes.push(omissionNote(omitted, omitted === 1 ? "child" : "children", `limit ${limit}`));
    }
    children = [...children]
      .sort((a, b) => compareCardTimestampDescending(
        getCard(getNodeCard(a.id).card_id),
        getCard(getNodeCard(b.id).card_id)
      ))
      .slice(0, limit);
  }
  return { children, notes };
}

function buildIdLabel(nodeId: string, cardId: string): string {
  return `[node:${nodeId} card:${cardId}]`;
}

function buildMetaComment(
  nodeId: string,
  card: Card,
  depth: number,
  chars?: number,
  isSymlink?: boolean
): string {
  const parts = [`node:${nodeId}`, `card:${card.id}`, `depth:${depth}`];
  const ts = formatCardTimestamp(card.card_timestamp);
  if (ts) {
    parts.push(`created:${ts.slice(0, 10)}`);
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

function timestampMilliseconds(value: unknown): number | null {
  if (value instanceof Date) {
    const milliseconds = value.getTime();
    return Number.isNaN(milliseconds) ? null : milliseconds;
  }
  if (typeof value === "string" && value.length > 0) {
    const milliseconds = Date.parse(value);
    return Number.isNaN(milliseconds) ? null : milliseconds;
  }
  return null;
}

function formatCardTimestamp(value: unknown): string | null {
  if (typeof value === "string") {
    return value || null;
  }
  const milliseconds = timestampMilliseconds(value);
  return milliseconds === null ? null : new Date(milliseconds).toISOString();
}

function compareCardTimestampDescending(cardA: Card, cardB: Card): number {
  const timestampA = timestampMilliseconds(cardA.card_timestamp);
  const timestampB = timestampMilliseconds(cardB.card_timestamp);

  if (timestampA === null) return timestampB === null ? 0 : 1;
  if (timestampB === null) return -1;
  if (timestampA === timestampB) return 0;
  return timestampA > timestampB ? -1 : 1;
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
  if (!options.titlesOnly) {
    return renderSections(collectCompileSections(
      nodeId,
      getNodeCard,
      getChildren,
      getCard,
      depth,
      options,
      visited,
      headingLevel,
      numberPrefix,
      true
    ));
  }

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
    const indent = "  ".repeat(currentDepth);
    const prefix = currentDepth === 0 ? "" : "├── ";
    return `${indent}${prefix}${numberLabel}${card.title} *(cycle)*`;
  }

  const card = getCard(card_id);
  const contentChars = card.content?.length ?? 0;

  const indent = "  ".repeat(currentDepth);
  const prefix = currentDepth === 0 ? "" : "├── ";
  const symlinkMark = is_symlink ? "~ " : "";
  let metaPart: string;
  if (options.includeIds === true) {
    // full metadata HTML 주석 (명시적 true 보존)
    metaPart = " " + buildMetaComment(nodeId, card, currentDepth, contentChars, is_symlink);
  } else if (options.includeIds === false) {
    // minimal — UUID 생략 (명시적 false, pre-260508 legacy)
    metaPart = ` (${contentChars} chars)`;
  } else {
    // 디폴트 — 짧은 ID 라벨 + chars (260508)
    metaPart = ` ${buildIdLabel(nodeId, card.id)} (${contentChars} chars)`;
  }
  const lines = [`${indent}${prefix}${numberLabel}${symlinkMark}${card.title}${metaPart}`];

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

  const { children, notes } = selectChildren(nodeId, headingLevel, getNodeCard, getChildren, getCard, options);
  const childIndent = "  ".repeat(currentDepth + 1);
  for (const note of notes) lines.push(`${childIndent}${note}`);

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

/** Compile one record for each heading and body emitted by full-content mode. */
export function compileSections(
  nodeId: string,
  getNodeCard: (nodeId: string) => { card_id: string; is_symlink: boolean },
  getChildren: (nodeId: string) => TreeNode[],
  getCard: (cardId: string) => Card,
  depth: number,
  options: CompileOptions = {}
): CompileSection[] {
  return collectCompileSections(
    nodeId, getNodeCard, getChildren, getCard, depth, options, new Set(), 1, "", false
  ).map((section, index) => ({ ...section, index }));
}

function collectCompileSections(
  nodeId: string,
  getNodeCard: (nodeId: string) => { card_id: string; is_symlink: boolean },
  getChildren: (nodeId: string) => TreeNode[],
  getCard: (cardId: string) => Card,
  depth: number,
  options: CompileOptions,
  visited: ReadonlySet<string>,
  headingLevel: number,
  numberPrefix: string,
  withOmissionNotes: boolean
): CompileSection[] {
  if (options.excludeNodes?.has(nodeId)) return [];

  const { card_id, is_symlink } = getNodeCard(nodeId);
  const currentDepth = headingLevel - 1;
  const level = Math.min(headingLevel, 6);
  const numberLabel = options.numbering && numberPrefix ? `${numberPrefix} ` : "";
  const headingPrefix = "#".repeat(level);

  if (visited.has(card_id)) {
    const card = getCard(card_id);
    const cycleTitle = `${numberLabel}${card.title} (cycle)`;
    return [{
      index: -1,
      node_id: nodeId,
      card_id,
      card_version: card.version,
      depth: currentDepth,
      level,
      heading: `${headingPrefix} ${numberLabel}${card.title} *(cycle)*`,
      title: cycleTitle,
      cycle: true,
      chars: 0,
      headings: [],
      content: null,
    }];
  }

  const card = getCard(card_id);
  options.onCardEmitted?.(card_id);
  const content = card.content || null;
  const symlinkMark = is_symlink ? "~ " : "";
  const title = `${numberLabel}${symlinkMark}${card.title}`;
  const heading = options.includeIds === false
    ? `${headingPrefix} ${title}`
    : `${headingPrefix} ${title} ${buildMetaComment(nodeId, card, currentDepth, undefined, is_symlink)}`;
  let unfurlText: string | null | undefined;
  const resolved = options.resolvedRefs?.get(card_id);
  if (resolved) {
    unfurlText = resolved.ok
      ? resolved.result.text
      : `<!-- unfurl failed: ${resolved.sourceType} -->`;
  }

  const section: CompileSection = {
    index: -1,
    node_id: nodeId,
    card_id,
    card_version: card.version,
    depth: currentDepth,
    level,
    heading,
    title,
    cycle: false,
    chars: card.content?.length ?? 0,
    headings: extractMarkdownHeadings(card.content),
    content,
    ...(unfurlText !== undefined ? { unfurl_text: unfurlText } : {}),
  };

  if (depth <= 0) return [section];

  const nextVisited = new Set(visited);
  nextVisited.add(card_id);

  const { children, notes } = selectChildren(nodeId, headingLevel, getNodeCard, getChildren, getCard, options);
  const sections = [section];
  if (withOmissionNotes) {
    for (const note of notes) sections.push(omissionSection(section, note));
  }
  children.forEach((child, index) => {
    const childNumber = options.numbering
      ? numberPrefix ? `${numberPrefix}.${index + 1}` : `${index + 1}`
      : "";
    sections.push(...collectCompileSections(
      child.id,
      getNodeCard,
      getChildren,
      getCard,
      depth - 1,
      options,
      nextVisited,
      headingLevel + 1,
      childNumber,
      withOmissionNotes
    ));
  });

  return sections;
}

/** A note line in the compiled text; it is not a card, so it is never part of the sections API. */
function omissionSection(parent: CompileSection, note: string): CompileSection {
  return {
    index: -1,
    node_id: parent.node_id,
    card_id: parent.card_id,
    card_version: parent.card_version,
    depth: parent.depth + 1,
    level: Math.min(parent.level + 1, 6),
    heading: note,
    title: note,
    cycle: false,
    chars: 0,
    headings: [],
    content: null,
  };
}

function renderSections(sections: CompileSection[]): string {
  return sections.map((section) => {
    const lines = [section.heading];
    if (section.content) lines.push(section.content);
    if (section.unfurl_text !== undefined && section.unfurl_text !== null) {
      lines.push(section.unfurl_text);
    }
    return lines.join("\n");
  }).join("\n");
}
