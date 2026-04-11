import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executeBatchOp } from "../../services/batch.service.js";

const batchCreateItemSchema = z.object({
  temp_id: z.string(),
  card_type: z.enum(["structure", "knowledge"]),
  title: z.string().max(50),
  content: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  references: z.array(z.string().uuid()).optional(),
  content_timestamp: z.string().nullable().optional(),
  source_type: z.string().nullable().optional(),
  source_ref: z.string().nullable().optional(),
  parent_node_id: z.string().uuid().nullable().optional(),
  parent_temp_id: z.string().optional(),
  position: z.number().int().optional(),
});

const batchSymlinkItemSchema = z.object({
  card_id: z.string().uuid(),
  parent_node_id: z.string().uuid().nullable().optional(),
  parent_temp_id: z.string().optional(),
  position: z.number().int().optional(),
});

const batchUpdateItemSchema = z.object({
  card_id: z.string().uuid(),
  title: z.string().max(50).optional(),
  content: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  references: z.array(z.string().uuid()).optional(),
  content_timestamp: z.string().nullable().optional(),
  source_type: z.string().nullable().optional(),
  source_ref: z.string().nullable().optional(),
  source_snapshot: z.string().nullable().optional(),
  source_checksum: z.string().nullable().optional(),
  source_checked_at: z.string().nullable().optional(),
  expected_version: z.number().int().optional(),
});

const batchMoveItemSchema = z.object({
  node_id: z.string().uuid(),
  new_parent_node_id: z.string().uuid().nullable().optional(),
  parent_temp_id: z.string().optional(),
  new_position: z.number().int().optional(),
});

const batchDeleteItemSchema = z.object({
  card_id: z.string().uuid(),
});

export function registerBatchTools(server: McpServer, agentId: string): void {
  server.tool(
    "batch_op",
    [
      "Execute multiple card/tree operations in a single atomic transaction. All succeed or all are rolled back.",
      "Execution order: creates → symlinks → updates → moves → deletes.",
      "",
      "temp_id referencing:",
      "  • Each create item has a temp_id (any string, e.g. 't1').",
      "  • Other creates, symlinks, and moves can reference it via parent_temp_id to place nodes under the newly created card.",
      "  • temp_id is resolved to the real node_id after the create step.",
      "",
      "symlinks: create symlink nodes pointing to existing cards at new tree positions.",
      "  • card_id must reference an existing card (FK constraint — rolls back on invalid ID).",
      "  • Useful for placing a card under multiple parents without duplicating content.",
      "",
      "moves: node_id is the node to relocate; new_parent_node_id is the destination parent (null = root).",
      "",
      "deletes: removes the card and all its tree nodes.",
    ].join("\n"),
    {
      creates: z.array(batchCreateItemSchema).optional().describe("Cards to create. Processed first."),
      symlinks: z.array(batchSymlinkItemSchema).optional().describe("Symlinks to existing cards. Processed after creates."),
      updates: z.array(batchUpdateItemSchema).optional().describe("Card field updates. Processed after symlinks."),
      moves: z.array(batchMoveItemSchema).optional().describe("Node relocations. Processed after updates."),
      deletes: z.array(batchDeleteItemSchema).optional().describe("Cards to delete (with all tree nodes). Processed last."),
    },
    async (args) => {
      const result = await executeBatchOp(agentId, {
        creates: args.creates,
        symlinks: args.symlinks,
        updates: args.updates,
        moves: args.moves,
        deletes: args.deletes,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    }
  );
}
