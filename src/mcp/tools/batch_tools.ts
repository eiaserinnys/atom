import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executeBatchOp } from "../../services/batch.service.js";
import { CARD_TITLE_MAX_CHARS } from "../../shared/card-title.js";
import { uuidSchema } from "../uuid-schema.js";

const batchCreateItemSchema = z.object({
  temp_id: z.string(),
  card_type: z.enum(["structure", "knowledge"]),
  title: z.string().min(1).max(CARD_TITLE_MAX_CHARS),
  content: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  references: z.array(uuidSchema).optional(),
  content_timestamp: z.string().nullable().optional(),
  source_type: z.string().nullable().optional(),
  source_ref: z.string().nullable().optional(),
  parent_node_id: uuidSchema.nullable().optional().describe("node_id (tree position) of the parent. If it is a symlink node, the new node is placed under its canonical node. Omit (or null) for root level."),
  parent_temp_id: z.string().optional(),
  position: z.number().int().nonnegative().optional().describe("Sort key among siblings (usually in steps of 100), not a 0-based index. Omit to append at the end. To choose a spot, use a moves item with before/after."),
});

const batchSymlinkItemSchema = z.object({
  card_id: uuidSchema.describe("card_id (card content, shown as card: in compile_subtree output) of the existing card. Not a node_id."),
  parent_node_id: uuidSchema.nullable().optional().describe("node_id (tree position) of the parent. If it is a symlink node, the new node is placed under its canonical node. Omit (or null) for root level."),
  parent_temp_id: z.string().optional(),
  position: z.number().int().nonnegative().optional().describe("Sort key among siblings (usually in steps of 100), not a 0-based index. Omit to append at the end. To choose a spot, use a moves item with before/after."),
});

export const batchUpdateItemSchema = z.object({
  card_id: uuidSchema.describe("card_id (card content, shown as card: in compile_subtree output). Not a node_id."),
  title: z.string().min(1).max(CARD_TITLE_MAX_CHARS).optional(),
  content: z.string().nullable().optional().describe("New content. Replaces the whole body (send the full text). Null clears."),
  tags: z.array(z.string()).optional(),
  references: z.array(uuidSchema).optional(),
  content_timestamp: z.string().nullable().optional(),
  source_type: z.string().nullable().optional(),
  source_ref: z.string().nullable().optional(),
  expected_version: z.number().int().optional().describe("Version from get_card. Reject if card.version differs. Send it when another session may edit this card."),
}).strict();

// Exported for direct schema-level unit tests
// (P1-2 Zod rejection regression — see tests/unit/batch-tools-schema.test.ts).
export const batchNodeUpdateItemSchema = z.object({
  node_id: uuidSchema.describe("node_id (tree position, shown as node: in compile_subtree output). Not a card_id."),
  // P1-2: required (not optional) — see BatchNodeUpdateItem doc comment in
  // src/shared/types.ts for rationale. Allows null to explicitly clear the
  // column. To skip a node, omit the entire item from the array (do not
  // include {node_id} alone). Asymmetric with standalone update_node tool
  // and PATCH /tree/:nodeId route; both kept optional for no-op read pattern.
  journal_limit: z.number().int().nonnegative().nullable(),
});

const batchMoveItemSchema = z.object({
  node_id: uuidSchema.describe("node_id (tree position, shown as node: in compile_subtree output) of the node to move. Not a card_id."),
  new_parent_node_id: uuidSchema.nullable().optional().describe("node_id of the destination parent (a symlink node resolves to its canonical node). Null = root. Omit = keep current parent."),
  parent_temp_id: z.string().optional(),
  new_position: z.number().int().nonnegative().optional().describe("DEPRECATED — use before/after/to instead. Absolute sort key (not a sibling index)."),
  before: uuidSchema.optional().describe("Place immediately before this sibling node_id (a child of the destination parent). Use at most one of before, after, to."),
  after: uuidSchema.optional().describe("Place immediately after this sibling node_id (a child of the destination parent). Use at most one of before, after, to."),
  to: z.enum(["start", "end"]).optional().describe("Place at start or end of the parent's children. Use at most one of before, after, to."),
});

const batchChildOrderItemSchema = z.object({
  parent_node_id: uuidSchema.nullable().describe("node_id (tree position) of the parent that will hold these children (a symlink node resolves to its canonical node). Null = root."),
  order: z.array(uuidSchema).min(1).describe("node_ids (not card_ids) in the desired order. A node that currently sits under another parent is moved under parent_node_id.").refine(
    (arr) => new Set(arr).size === arr.length,
    "duplicate node_id in order"
  ),
});

const batchDeleteItemSchema = z.object({
  card_id: uuidSchema.describe("card_id (card content, shown as card: in compile_subtree output) to delete permanently. Not a node_id."),
});

export function registerBatchTools(server: McpServer, agentId: string): void {
  server.tool(
    "batch_op",
    [
      "Execute multiple card/tree operations in a single atomic transaction. All succeed or all are rolled back.",
      "Execution order: creates → symlinks → updates → node_updates → moves → child_orders → deletes.",
      "",
      "temp_id referencing:",
      "  • Each create item has a temp_id (any string, e.g. 't1').",
      "  • Other creates, symlinks, and moves can reference it via parent_temp_id to place nodes under the newly created card.",
      "  • temp_id is resolved to the real node_id after the create step.",
      "",
      "symlinks: create symlink nodes pointing to existing cards at new tree positions.",
      "  • card_id must reference an existing card; otherwise the error is `Card not found` and the whole batch rolls back.",
      "  • Useful for placing a card under multiple parents without duplicating content.",
      "",
      "updates: card field updates (title/content/tags/references/source/...). Targets card_id. Omitted fields are kept, but each field you send replaces the whole stored value: content is a full replacement, not a patch. If another session may edit the card, send expected_version from get_card.",
      "",
      "node_updates: tree_node property updates (journal_limit). Targets pre-existing node_id only — temp_id is not supported here.",
      "  • Duplicate node_id within node_updates: items are applied in array order under one transaction, so the last entry wins. The id appears once per occurrence in the result. Deduplicate by node_id before calling unless you intend this.",
      "",
      "moves: node_id is the node to relocate.",
      "  • Destination parent: new_parent_node_id = a node_id moves the node under that parent (a symlink node resolves to its canonical node); null = root; omit it = the node stays under its current parent and only its position among those siblings changes (it never moves to root).",
      "  • Position (choose at most one of before, after, to): before/after = place next to that sibling, which must already be a child of the destination parent; to = 'start' or 'end' of the parent's children. Giving more than one of before, after, to, new_position is rejected. Omit all = append at the end of the parent's children.",
      "  • new_position is deprecated and not for new calls: it is an absolute sort key, not a sibling index, and the result carries a deprecation warning. Use before/after/to instead.",
      "",
      "child_orders: set the full order of the children under one parent in a single item, instead of one move per node.",
      "  • Processed AFTER moves, BEFORE deletes.",
      "  • order: array of node_ids in the desired sequence. Every node in order ends up under parent_node_id, including a node that currently sits under another parent: it is moved there, silently. List only nodes that should end up under this parent. A symlink parent_node_id resolves to its canonical node.",
      "  • Nodes under the parent but NOT in order keep their existing keys (they are not reordered); list every child whose order matters.",
      "",
      "Parent placement: for creates, symlinks, moves and child_orders, a parent_node_id that is a symlink node resolves to its canonical node, so the new or moved node is placed under the canonical node. The results of creates (temp_id, card_id, node_id), symlinks (node_id) and moves (node_id) do not include the parent, so call get_node to confirm it. child_ordered in the result lists the resolved (canonical) parent node_id of each child_orders item.",
      "",
      "deletes: permanently removes the card, every tree node of that card (symlinks included) and the whole subtree below each of those nodes. Cards in those subtrees that have no tree node left elsewhere are permanently deleted too; cards that still have a node outside the deleted subtrees are kept. This cannot be undone. To keep a card from the subtree, move it out (moves) or give it another node elsewhere (symlinks) in the same batch; deletes run last. A card_id that did not exist when the batch started fails the whole batch with `Card not found: <id>`. A card an earlier item of the same batch already deleted (a subtree card, or the same card_id twice) is skipped without an error and without a second card:deleted event. The result's deleted lists the requested card_ids this batch actually deleted; cascade_deleted_card_ids lists the cards it deleted that were not requested (subtree cards with no node left elsewhere).",
    ].join("\n"),
    {
      creates: z.array(batchCreateItemSchema).optional().describe("Cards to create. Processed first."),
      symlinks: z.array(batchSymlinkItemSchema).optional().describe("Symlinks to existing cards. Processed after creates."),
      updates: z.array(batchUpdateItemSchema).optional().describe("Card field updates. Processed after symlinks."),
      node_updates: z.array(batchNodeUpdateItemSchema).optional().describe("Tree node property updates (journal_limit). Pre-existing node_id only (no temp_id). Processed after updates, before moves. Duplicate node_id: applied in array order, last entry wins; id appears once per occurrence in result.node_updated. Deduplicate before calling unless intentional."),
      moves: z.array(batchMoveItemSchema).optional().describe("Node relocations. Processed after node_updates. Position with at most one of before/after/to (not new_position, which is deprecated). Omit new_parent_node_id to keep the current parent and only change the position among its siblings."),
      child_orders: z.array(batchChildOrderItemSchema).optional().describe("Set the full child order under a parent; any listed node that sits under another parent is moved under this one. Processed after moves, before deletes."),
      deletes: z.array(batchDeleteItemSchema).optional().describe("Cards to delete permanently (with all their tree nodes and the subtrees below them; subtree cards left with no node elsewhere are deleted too, see cascade_deleted_card_ids in the result). A card_id that did not exist at the start fails the batch. Processed last."),
    },
    async (args) => {
      const result = await executeBatchOp(agentId, {
        creates: args.creates,
        symlinks: args.symlinks,
        updates: args.updates,
        node_updates: args.node_updates,
        moves: args.moves,
        child_orders: args.child_orders,
        deletes: args.deletes,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    }
  );
}
