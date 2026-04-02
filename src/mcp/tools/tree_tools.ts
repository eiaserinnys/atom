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
    "Get a tree node with its card data.",
    { node_id: z.string().uuid() },
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
    "List child nodes. If parent_node_id is null, returns root nodes.",
    { parent_node_id: z.string().uuid().nullable().optional() },
    async ({ parent_node_id }) => {
      const children = await listChildren(parent_node_id ?? null);
      return { content: [{ type: "text", text: JSON.stringify(children) }] };
    }
  );

  // get_tree
  server.tool(
    "get_tree",
    "Get root-level tree nodes. Returns the flat list of root nodes. Use compile_subtree for depth-expanded markdown.",
    {},
    async () => {
      const roots = await listChildren(null);
      return { content: [{ type: "text", text: JSON.stringify(roots) }] };
    }
  );

  // compile_subtree
  server.tool(
    "compile_subtree",
    "Compile a subtree as Markdown via BFS. depth=2 by default. include_ids=true adds <!-- node:uuid card:uuid --> HTML comments to each heading.",
    {
      node_id: z.string().uuid(),
      depth: z.number().int().optional(),
      include_ids: z.boolean().optional(),
    },
    async ({ node_id, depth, include_ids }) => {
      const markdown = await compileSubtree(node_id, depth ?? 2, {
        includeIds: include_ids,
      });
      return { content: [{ type: "text", text: markdown }] };
    }
  );

  // create_symlink
  server.tool(
    "create_symlink",
    "Create a symlink node pointing to the same card_id at a different tree position.",
    {
      card_id: z.string().uuid(),
      parent_node_id: z.string().uuid().nullable().optional(),
      position: z.number().int().optional(),
    },
    async ({ card_id, parent_node_id, position }) => {
      const node = await createSymlink(card_id, parent_node_id ?? null, position);
      return { content: [{ type: "text", text: JSON.stringify(node) }] };
    }
  );

  // move_node
  server.tool(
    "move_node",
    "Move a tree node to a new parent and/or position.",
    {
      node_id: z.string().uuid(),
      parent_node_id: z.string().uuid().nullable().optional(),
      position: z.number().int().optional(),
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
    "Delete only the tree node (card is preserved). Cascades to child nodes.",
    { node_id: z.string().uuid() },
    async ({ node_id }) => {
      const deleted = await deleteNode(node_id);
      return {
        content: [{ type: "text", text: deleted ? "Deleted" : "Not found" }],
        isError: !deleted,
      };
    }
  );
}
