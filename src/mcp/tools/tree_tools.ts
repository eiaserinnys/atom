import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TreeCycleError } from "../../db/queries/tree.js";
import { nodeNotFound } from "../../services/service-errors.js";
import type { AgentScope } from "../../shared/types.js";
import {
  getNode,
  listChildren,
  compileSubtree,
  createSymlink,
  deleteNode,
  previewNodeDeletion,
  moveNode,
  updateNodeProperties,
} from "../../services/tree.service.js";
import { uuidSchema } from "../uuid-schema.js";
import { DRY_RUN_DESCRIPTION, deletionResultContent } from "./deletion-result.js";

export function registerTreeTools(server: McpServer, scope: AgentScope = "write"): void {
  // get_node
  server.tool(
    "get_node",
    "Get a single tree node by its node_id, including the associated card data (title, content, tags, references, timestamps). Returns the node's position, parent, and is_symlink flag.",
    { node_id: uuidSchema.describe("node_id (tree position, shown as node: in compile_subtree output). Not a card_id.") },
    async ({ node_id }) => {
      const node = await getNode(node_id);
      if (!node) throw await nodeNotFound(node_id);
      return { content: [{ type: "text", text: JSON.stringify(node) }] };
    }
  );

  // list_children
  server.tool(
    "list_children",
    "List direct child nodes of a parent, ordered by position. Pass null or omit parent_node_id to get root-level nodes. Each child includes its card data.",
    { parent_node_id: uuidSchema.nullable().optional().describe("node_id (tree position) of the parent. Null or omitted = root nodes.") },
    async ({ parent_node_id }) => {
      const children = await listChildren(parent_node_id ?? null);
      return { content: [{ type: "text", text: JSON.stringify(children) }] };
    }
  );

  // get_tree
  server.tool(
    "get_tree",
    "Get all root-level tree nodes (nodes with no parent). Returns a flat list; use compile_subtree to expand a subtree into markdown.",
    {},
    async () => {
      const roots = await listChildren(null);
      return { content: [{ type: "text", text: JSON.stringify(roots) }] };
    }
  );

  // compile_subtree
  server.tool(
    "compile_subtree",
    [
      "Compile a subtree into Markdown (BFS traversal).",
      "Output modes:",
      "  • Default: full markdown with # headings per depth level and card content. Each heading carries an HTML metadata comment <!-- node:<uuid> card:<uuid> depth:<N> ... --> by default (260508).",
      "  • titles_only=true: indented tree of card titles with `[node:<uuid> card:<uuid>] (N chars)` per line by default.",
      "Options:",
      "  • depth (default 3): how many levels deep to expand, 0 or more (a negative value is rejected). Pass null to drill the full tree without limit (use with caution on large trees).",
      "  • include_ids: tri-state. Omit (default) for the standard ID-annotated output — short `[node:X card:Y]` label in titles_only mode, full HTML metadata comment in heading mode. Pass true to force full HTML metadata in titles_only mode as well (no effect in heading mode — equals default). Pass false for minimal output with no IDs (pre-260508 legacy behavior).",
      "  • numbering=true: prepends hierarchical numbering (1, 1.1, 1.1.1, …) to each heading. Root node is unnumbered; children start at 1.",
      "  • max_chars: truncates output to at most N characters (on a line boundary) and appends <!-- truncated: M chars omitted -->. The first line is always kept whole, so an N smaller than it still returns that line. 0 or negative = no limit.",
      "  • exclude_nodes: array of node_id UUIDs whose subtrees are entirely skipped. Unknown IDs are silently ignored. If the root node itself is excluded, returns an empty string.",
      "  • limit: restrict direct children (depth=1) to the latest n items by card_timestamp. Does not affect deeper levels.",
      "  • Left-out children: when a node's journal_limit or the limit option shows only some of its children, one line such as <!-- omitted: 12 older children (journal_limit 5) --> or <!-- omitted: 30 children (limit 20) --> appears under that node (in titles_only mode at the indentation of its children). Nothing is added when no child was left out.",
      "  • Symlink nodes are prefixed with ~ in the title to distinguish them from canonical nodes.",
      "Common combinations: titles_only + max_chars caps large tree overviews while keeping IDs.",
    ].join("\n"),
    {
      node_id: uuidSchema.describe("node_id (tree position, shown as node: in compile_subtree output) of the subtree root. Not a card_id."),
      depth: z.number().int().nullable().optional().describe("Max depth to expand, 0 or more (default 3). Pass null to drill the entire tree without limit. Negative values are rejected."),
      include_ids: z.boolean().optional().describe("Tri-state. Omit (default) for ID-annotated output: short [node:X card:Y] label in titles_only, full HTML metadata in heading mode. true = full HTML metadata in titles_only mode as well (no effect in heading mode). false = minimal (no IDs, legacy)."),
      titles_only: z.boolean().optional().describe("Output indented title tree instead of full markdown."),
      numbering: z.boolean().optional().describe("Prepend hierarchical numbering (1, 1.1, 1.1.1, …) to headings."),
      max_chars: z.number().int().optional().describe("Max output chars. 0 or negative = unlimited."),
      exclude_nodes: z.array(uuidSchema).optional().describe("Node IDs whose subtrees to skip entirely."),
      limit: z.number().int().positive().optional().describe("Limit direct children (depth=1) to latest n items by card_timestamp. Independent of journal_limit: journal_limit is a per-node DB property that filters children by position order; limit is a compile-time option that filters depth=1 children by card_timestamp across the whole request."),
      resolve_refs: z.enum(["cached", "fresh"]).optional().describe("Resolve external references (unfurl). 'cached': use snapshot if available; 'fresh': always fetch."),
      credentials: z.record(z.string(), z.record(z.string(), z.string())).optional().describe("Credentials per source_type, e.g. { trello: { apiKey: '...', token: '...' } }."),
    },
    async ({ node_id, depth, include_ids, titles_only, numbering, max_chars, exclude_nodes, limit, resolve_refs, credentials }) => {
      const result = await compileSubtree(node_id, depth === null ? Infinity : (depth ?? 3), {
        includeIds: include_ids,
        titlesOnly: titles_only,
        numbering,
        maxChars: max_chars,
        excludeNodes: exclude_nodes ? new Set(exclude_nodes) : undefined,
        limit,
      }, resolve_refs, credentials, scope === "write");
      return { content: [{ type: "text", text: result.markdown }] };
    }
  );

  // create_symlink
  server.tool(
    "create_symlink",
    "Create a symlink node that references an existing card at a different tree location. The card itself is not duplicated — the new node points to the same card_id, enabling a single card to appear under multiple parents. If parent_node_id is itself a symlink node, the new node is placed under that symlink's canonical node; check parent_node_id in the response.",
    {
      card_id: uuidSchema.describe("card_id (card content, shown as card: in compile_subtree output) of the existing card to symlink to. Not a node_id."),
      parent_node_id: uuidSchema.nullable().optional().describe("node_id (tree position) of the parent for the new symlink. If it is a symlink node, the new node goes under its canonical node. Null = root level."),
      position: z.number().int().nonnegative().optional().describe("Sort key among siblings (usually in steps of 100), not a 0-based index. Omit to append at the end. To choose a spot, use move_node with before/after."),
    },
    async ({ card_id, parent_node_id, position }) => {
      const node = await createSymlink(card_id, parent_node_id ?? null, position);
      return { content: [{ type: "text", text: JSON.stringify(node) }] };
    }
  );

  // move_node
  server.tool(
    "move_node",
    [
      "Move a tree node to a new parent and/or position.",
      "",
      "Positioning (mutually exclusive — pick ONE):",
      "  • before: place immediately before this sibling node_id.",
      "  • after: place immediately after this sibling node_id.",
      "  • to: 'start' = first child, 'end' = last child of the parent.",
      "  • position (DEPRECATED): absolute sort key (not a sibling index). Still works but emits a deprecation warning.",
      "  • Omit all four: append at end (same as to='end').",
      "",
      "Parent (destination):",
      "  • parent_node_id = UUID: move under that node. If it is a symlink node, the node lands under its canonical node; check parent_node_id in the response.",
      "  • parent_node_id = null: move to root level.",
      "  • Omit parent_node_id: KEEP CURRENT PARENT (default). Useful for reordering within the same parent.",
    ].join("\n"),
    {
      node_id: uuidSchema.describe("node_id (tree position, shown as node: in compile_subtree output) of the node to move. Not a card_id."),
      parent_node_id: uuidSchema.nullable().optional().describe("node_id of the destination parent (a symlink node resolves to its canonical node). Null = root. Omit = keep current parent."),
      before: uuidSchema.optional().describe("Place before this sibling node_id."),
      after: uuidSchema.optional().describe("Place after this sibling node_id."),
      to: z.enum(["start", "end"]).optional().describe("Place at start or end of parent's children."),
      position: z.number().int().nonnegative().optional().describe("DEPRECATED — use before/after/to instead. Absolute sort key (not a sibling index)."),
    },
    async ({ node_id, parent_node_id, before, after, to, position }) => {
      try {
        const { node: moved, warnings } = await moveNode(node_id, {
          parent_node_id,
          before,
          after,
          to,
          position,
        });
        if (!moved) throw await nodeNotFound(node_id);
        const response = warnings.length > 0
          ? { ...moved, _warnings: warnings }
          : moved;
        return { content: [{ type: "text", text: JSON.stringify(response) }] };
      } catch (error) {
        if (!(error instanceof TreeCycleError)) throw error;
        return {
          content: [{ type: "text", text: JSON.stringify({ error: { code: error.code, message: error.message } }) }],
          isError: true,
        };
      }
    }
  );

  // update_node
  server.tool(
    "update_node",
    [
      "Update tree node properties (journal_limit). Partial update — only provided fields are changed; omitted fields are left untouched.",
      "journal_limit: number of most-recent children (by position desc) to include when compile_subtree descends into this node.",
      "  • null — no limit (default).",
      "  • 0 — include all children (alias for 'unlimited').",
      "  • N (>0) — include the top N children by position desc.",
      "Symlink nodes store their own journal_limit; this is intentional (not redirected to canonical).",
      "Targets a pre-existing node_id only; temp_id references are not supported.",
    ].join("\n"),
    {
      node_id: uuidSchema.describe("node_id (tree position, shown as node: in compile_subtree output) to update. Not a card_id."),
      journal_limit: z
        .number()
        .int()
        .nonnegative()
        .nullable()
        .optional()
        .describe("Per-node children limit. null = no limit; 0 = unlimited; N = latest N by position desc."),
    },
    async ({ node_id, journal_limit }) => {
      const props: { journal_limit?: number | null } = {};
      if (journal_limit !== undefined) props.journal_limit = journal_limit;
      const node = await updateNodeProperties(node_id, props);
      if (!node) throw await nodeNotFound(node_id);
      return { content: [{ type: "text", text: JSON.stringify(node) }] };
    }
  );

  // delete_node
  server.tool(
    "delete_node",
    "Delete a tree node and all its descendant nodes. Cards in that subtree (including the node's own card) that have no tree node left elsewhere are permanently deleted with them; cards that still have a node outside the deleted subtree are kept. This cannot be undone. To keep such a card, move it out first (move_node) or give it another node elsewhere (create_symlink). A symlink node is deleted by the same rule: the node and the nodes below it go, and a card is deleted permanently only when no node of it is left elsewhere (for the symlink's own card that happens when it was the card's last node, for example after the canonical node was deleted), so check with dry_run first. Returns JSON { deleted: true, deleted_card_ids, deleted_node_count }: deleted_card_ids lists every card this call deleted permanently (empty when none was), deleted_node_count the nodes removed. Pass dry_run: true to see the same lists without deleting anything. A kept subtree card whose own node is deleted stays only through its symlink outside the subtree, without the children it had below the deleted node.",
    {
      node_id: uuidSchema.describe("node_id (tree position, shown as node: in compile_subtree output) to delete, with all its descendants. Not a card_id; to delete a card and all its nodes use delete_card."),
      dry_run: z.boolean().optional().describe(DRY_RUN_DESCRIPTION),
    },
    async ({ node_id, dry_run }) => {
      const dryRun = dry_run === true;
      const summary = dryRun ? await previewNodeDeletion(node_id) : await deleteNode(node_id);
      if (!summary) throw await nodeNotFound(node_id);
      return deletionResultContent(summary, dryRun);
    }
  );
}
