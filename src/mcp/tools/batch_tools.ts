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
  parent_node_id: z.string().uuid().nullable(),
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
      "Execute multiple card operations (creates/symlinks/updates/moves/deletes) in a single atomic transaction.",
      "Execution order: creates → symlinks → updates → moves → deletes.",
      "Use temp_id to reference newly-created nodes within the same batch as parent_temp_id.",
      "All operations succeed or all are rolled back.",
    ].join(" "),
    {
      creates: z.array(batchCreateItemSchema).optional(),
      symlinks: z.array(batchSymlinkItemSchema).optional(),
      updates: z.array(batchUpdateItemSchema).optional(),
      moves: z.array(batchMoveItemSchema).optional(),
      deletes: z.array(batchDeleteItemSchema).optional(),
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
