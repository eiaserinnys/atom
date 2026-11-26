import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createCard,
  getCard,
  updateCard,
  deleteCard,
  getBacklinks,
} from "../../services/card.service.js";

export function registerCardTools(server: McpServer, agentId: string): void {
  // create_card
  server.tool(
    "create_card",
    "Create a new card and its tree node. Returns the card object with node_id (the new tree position). A 'structure' card organizes hierarchy (folder-like); a 'knowledge' card holds atomic content. If parent_node_id is a symlink node, the card is placed under that symlink's canonical node; the response has no parent_node_id, so call get_node with the returned node_id to confirm the parent.",
    {
      card_type: z.enum(["structure", "knowledge"]).describe("'structure' for hierarchy/folder nodes, 'knowledge' for content-bearing cards."),
      title: z.string().max(50).describe("Card title (max 50 chars)."),
      content: z.string().optional().describe("Card body text (markdown). Null for structure cards."),
      parent_node_id: z.string().uuid().optional().describe("node_id (tree position, shown as node: in compile_subtree output) of the parent. If it is a symlink node, the card goes under its canonical node. Omit to create at root level."),
      position: z.number().int().nonnegative().optional().describe("Sort key among siblings (usually in steps of 100), not a 0-based index. Omit to append at the end. To choose a spot, use move_node with before/after."),
      tags: z.array(z.string()).optional().describe("Freeform tags for categorization and search."),
      references: z.array(z.string().uuid()).optional().describe("Card UUIDs this card references (creates backlinks)."),
      content_timestamp: z.string().optional().describe("ISO timestamp for when the content was originally authored."),
      source_type: z.string().optional().describe("Origin type, e.g. 'pdf', 'web', 'manual'."),
      source_ref: z.string().optional().describe("Origin reference, e.g. URL or file path."),
    },
    async (args) => {
      const { card, node_id } = await createCard(agentId, {
        card_type: args.card_type,
        title: args.title,
        content: args.content ?? null,
        parent_node_id: args.parent_node_id ?? null,
        position: args.position,
        tags: args.tags ?? [],
        references: args.references ?? [],
        content_timestamp: args.content_timestamp ?? null,
        source_type: args.source_type ?? null,
        source_ref: args.source_ref ?? null,
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ ...card, node_id }) }],
      };
    }
  );

  // get_card
  server.tool(
    "get_card",
    "Get a card by its card_id. Returns all card fields including title, content, tags, references, timestamps, and version. Pass the returned version as expected_version to update_card when another session may edit the same card.",
    { card_id: z.string().uuid().describe("card_id (card content, shown as card: in compile_subtree output). Not a node_id.") },
    async ({ card_id }) => {
      const card = await getCard(card_id);
      if (!card) {
        return { content: [{ type: "text", text: `Card not found: ${card_id}` }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(card) }] };
    }
  );

  // update_card
  server.tool(
    "update_card",
    "Update card fields. Partial means per field: omitted fields are left unchanged, but every field you send replaces the whole stored value. content is a full replacement, not a patch — send the entire new body, because any part you leave out is lost (the same holds for tags and references arrays). When content is modified, content_timestamp is automatically set to now. If another session may edit the same card, read it with get_card and send its version as expected_version: if the card's current version differs, the update is rejected with a VersionConflict error. Without expected_version the last write wins.",
    {
      card_id: z.string().uuid().describe("card_id (card content, shown as card: in compile_subtree output). Not a node_id."),
      title: z.string().max(50).optional().describe("New title (max 50 chars)."),
      content: z.string().nullable().optional().describe("New content. Replaces the whole body (send the full text). Pass null to clear."),
      tags: z.array(z.string()).optional().describe("Replace all tags with this array."),
      references: z.array(z.string().uuid()).optional().describe("Replace all references with these card UUIDs."),
      content_timestamp: z.string().optional().describe("Override the auto-set content timestamp (ISO format)."),
      source_type: z.string().nullable().optional().describe("Update origin type. Null to clear."),
      source_ref: z.string().nullable().optional().describe("Update origin reference. Null to clear."),
      expected_version: z.number().int().optional().describe("Optimistic lock: version from get_card. Reject if card.version ≠ this value. Send it when another session may edit this card."),
    },
    async (args) => {
      const { card_id, expected_version, ...input } = args;
      const result = await updateCard(agentId, card_id, input, expected_version);
      if (!result) {
        return { content: [{ type: "text", text: `Card not found: ${card_id}` }], isError: true };
      }
      if (result.conflict) {
        throw new Error(`VersionConflict: card ${card_id} expected version ${expected_version}, actual ${result.actualVersion}`);
      }
      return { content: [{ type: "text", text: JSON.stringify(result.card) }] };
    }
  );

  // delete_card
  server.tool(
    "delete_card",
    "Delete a card permanently. Every tree node of this card (symlinks included) is removed together with the whole subtree below each of them. Cards in those subtrees that have no tree node left elsewhere are permanently deleted too; cards that still have a node outside the deleted subtrees are kept. This cannot be undone. To keep a card that sits in the subtree, move it out first (move_node) or give it another node elsewhere (create_symlink) before deleting.",
    { card_id: z.string().uuid().describe("card_id (card content, shown as card: in compile_subtree output) to delete permanently. Not a node_id; to delete one tree node use delete_node.") },
    async ({ card_id }) => {
      const deleted = await deleteCard(card_id);
      return {
        content: [{ type: "text", text: deleted ? "Deleted" : "Not found" }],
        isError: !deleted,
      };
    }
  );

  // get_backlinks
  server.tool(
    "get_backlinks",
    "Find all cards that reference this card in their references[] field. Returns an array of referencing cards with their full data. Useful for discovering related knowledge.",
    { card_id: z.string().uuid().describe("card_id (card content, shown as card: in compile_subtree output) to find backlinks for. Not a node_id.") },
    async ({ card_id }) => {
      const links = await getBacklinks(card_id);
      return { content: [{ type: "text", text: JSON.stringify(links) }] };
    }
  );
}
