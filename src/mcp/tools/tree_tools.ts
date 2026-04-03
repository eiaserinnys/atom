import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getNode,
  listChildren,
  compileSubtree,
  createSymlink,
  deleteNode,
  moveNode,
} from "../../services/tree.service.js";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function registerTreeTools(server: McpServer, _agentId: string): void {
  // get_node
  server.tool(
    "get_node",
    "Get a single tree node by its node_id, including the associated card data (title, content, tags, references, timestamps). Returns the node's position, parent, and is_symlink flag.",
    { node_id: z.string().uuid().describe("The tree node UUID to retrieve.") },
    async ({ node_id }) => {
      const node = await getNode(node_id);
      if (!node) {
        return { content: [{ type: "text", text: `Node not found: ${node_id}` }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(node) }] };
    }
  );

  // list_children
  server.tool(
    "list_children",
    "List direct child nodes of a parent, ordered by position. Pass null or omit parent_node_id to get root-level nodes. Each child includes its card data.",
    { parent_node_id: z.string().uuid().nullable().optional().describe("Parent node UUID. Null or omitted = root nodes.") },
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
      "  • Default: full markdown with # headings per depth level and card content.",
      "  • titles_only=true: indented tree of card titles with content size in chars — useful for quick overviews.",
      "Options:",
      "  • depth (default 2): how many levels deep to expand.",
      "  • include_ids=true: appends <!-- node:<uuid> card:<uuid> depth:<N> --> HTML comments to each heading for programmatic reference.",
      "  • numbering=true: prepends hierarchical numbering (1, 1.1, 1.1.1, …) to each heading. Root node is unnumbered; children start at 1.",
      "  • max_chars: truncates output to at most N characters (on a line boundary) and appends <!-- truncated: M chars omitted -->. 0 or negative = no limit.",
      "  • exclude_nodes: array of node_id UUIDs whose subtrees are entirely skipped. Unknown IDs are silently ignored. If the root node itself is excluded, returns an empty string.",
      "  • Symlink nodes are prefixed with ~ in the title to distinguish them from canonical nodes.",
      "Common combinations: titles_only + include_ids gives an ID-annotated outline; titles_only + max_chars caps large tree overviews.",
    ].join("\n"),
    {
      node_id: z.string().uuid().describe("Root node of the subtree to compile."),
      depth: z.number().int().optional().describe("Max depth to expand (default 2)."),
      include_ids: z.boolean().optional().describe("Add <!-- node/card/depth --> HTML comments to headings."),
      titles_only: z.boolean().optional().describe("Output indented title tree instead of full markdown."),
      numbering: z.boolean().optional().describe("Prepend hierarchical numbering (1, 1.1, 1.1.1, …) to headings."),
      max_chars: z.number().int().optional().describe("Max output chars. 0 or negative = unlimited."),
      exclude_nodes: z.array(z.string().uuid()).optional().describe("Node IDs whose subtrees to skip entirely."),
    },
    async ({ node_id, depth, include_ids, titles_only, numbering, max_chars, exclude_nodes }) => {
      const markdown = await compileSubtree(node_id, depth ?? 2, {
        includeIds: include_ids,
        titlesOnly: titles_only,
        numbering,
        maxChars: max_chars,
        excludeNodes: exclude_nodes ? new Set(exclude_nodes) : undefined,
      });
      return { content: [{ type: "text", text: markdown }] };
    }
  );

  // create_symlink
  server.tool(
    "create_symlink",
    "Create a symlink node that references an existing card at a different tree location. The card itself is not duplicated — the new node points to the same card_id, enabling a single card to appear under multiple parents.",
    {
      card_id: z.string().uuid().describe("The existing card UUID to symlink to."),
      parent_node_id: z.string().uuid().nullable().optional().describe("Parent node for the new symlink. Null = root level."),
      position: z.number().int().optional().describe("0-based position among siblings. Omit to append at end."),
    },
    async ({ card_id, parent_node_id, position }) => {
      const node = await createSymlink(card_id, parent_node_id ?? null, position);
      return { content: [{ type: "text", text: JSON.stringify(node) }] };
    }
  );

  // move_node
  server.tool(
    "move_node",
    "Move a tree node to a new parent and/or position. Note: parent_node_id is the DESTINATION parent (the node to move under), not a field called new_parent_node_id. Pass null to move to root level.",
    {
      node_id: z.string().uuid().describe("The node to move."),
      parent_node_id: z.string().uuid().nullable().optional().describe("Destination parent node. Null = move to root level."),
      position: z.number().int().optional().describe("0-based position among siblings at the destination. Omit to append at end."),
    },
    async ({ node_id, parent_node_id, position }) => {
      const moved = await moveNode(node_id, parent_node_id ?? null, position);
      if (!moved) {
        return { content: [{ type: "text", text: `Node not found: ${node_id}` }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(moved) }] };
    }
  );

  // delete_node
  server.tool(
    "delete_node",
    "Delete a tree node and all its descendants. The underlying card(s) are preserved — only the tree structure is removed. Use delete_card to remove a card entirely.",
    { node_id: z.string().uuid().describe("The tree node UUID to delete (cascades to children).") },
    async ({ node_id }) => {
      const deleted = await deleteNode(node_id);
      return {
        content: [{ type: "text", text: deleted ? "Deleted" : "Not found" }],
        isError: !deleted,
      };
    }
  );
}
