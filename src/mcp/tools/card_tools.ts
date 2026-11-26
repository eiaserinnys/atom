import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createCard,
  getCard,
  updateCard,
  deleteCard,
  previewCardDeletion,
  getBacklinks,
} from "../../services/card.service.js";
import { CARD_TITLE_MAX_CHARS } from "../../shared/card-title.js";
import { cardNotFound, ConflictError, versionConflictMessage } from "../../services/service-errors.js";
import { uuidSchema } from "../uuid-schema.js";
import { DRY_RUN_DESCRIPTION, deletionResultContent } from "./deletion-result.js";

export function registerCardTools(server: McpServer, agentId: string): void {
  // create_card
  server.tool(
    "create_card",
    "Create a new card and its tree node. Returns the card object with node_id (the new tree position). A 'structure' card organizes hierarchy (folder-like); a 'knowledge' card holds atomic content. If parent_node_id is a symlink node, the card is placed under the canonical node of that symlink's card (one of them if there are several, the symlink node itself if there is none); the response has no parent_node_id, so call get_node with the returned node_id to confirm the parent.",
    {
      card_type: z.enum(["structure", "knowledge"]).describe("'structure' for hierarchy/folder nodes, 'knowledge' for content-bearing cards."),
      title: z.string().min(1).max(CARD_TITLE_MAX_CHARS).describe("Card title (1-50 chars, not blank)."),
      content: z.string().optional().describe("Card body text (markdown). Null for structure cards."),
      parent_node_id: uuidSchema.optional().describe("node_id (tree position, shown as node: in compile_subtree output) of the parent. If it is a symlink node, the card goes under the canonical node of that symlink's card (one of them if there are several, the symlink node itself if there is none). Omit to create at root level."),
      position: z.number().int().nonnegative().optional().describe("Sort key among siblings (usually in steps of 100), not a 0-based index. Omit to append at the end. To choose a spot, use move_node with before/after."),
      tags: z.array(z.string()).optional().describe("Freeform tags for categorization and search."),
      references: z.array(uuidSchema).optional().describe("Card UUIDs this card references (creates backlinks)."),
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
    { card_id: uuidSchema.describe("card_id (card content, shown as card: in compile_subtree output). Not a node_id.") },
    async ({ card_id }) => {
      const card = await getCard(card_id);
      if (!card) throw await cardNotFound(card_id);
      return { content: [{ type: "text", text: JSON.stringify(card) }] };
    }
  );

  // update_card
  server.tool(
    "update_card",
    "Update card fields. Partial means per field: omitted fields are left unchanged, but every field you send replaces the whole stored value. content is a full replacement, not a patch — send the entire new body, because any part you leave out is lost (the same holds for tags and references arrays). When content is modified, content_timestamp is automatically set to now. If another session may edit the same card, read it with get_card and send its version as expected_version: if the card's current version differs, the update is rejected with a VersionConflict error. Without expected_version the last write wins.",
    {
      card_id: uuidSchema.describe("card_id (card content, shown as card: in compile_subtree output). Not a node_id."),
      title: z.string().min(1).max(CARD_TITLE_MAX_CHARS).optional().describe("New title (1-50 chars, not blank)."),
      content: z.string().nullable().optional().describe("New content. Replaces the whole body (send the full text). Pass null to clear."),
      tags: z.array(z.string()).optional().describe("Replace all tags with this array."),
      references: z.array(uuidSchema).optional().describe("Replace all references with these card UUIDs."),
      content_timestamp: z.string().optional().describe("Override the auto-set content timestamp (ISO format)."),
      source_type: z.string().nullable().optional().describe("Update origin type. Null to clear."),
      source_ref: z.string().nullable().optional().describe("Update origin reference. Null to clear."),
      expected_version: z.number().int().optional().describe("Optimistic lock: version from get_card. Reject if card.version ≠ this value. Send it when another session may edit this card."),
    },
    async (args) => {
      const { card_id, expected_version, ...input } = args;
      const result = await updateCard(agentId, card_id, input, expected_version);
      if (!result) throw await cardNotFound(card_id);
      if (result.conflict) {
        throw new ConflictError(versionConflictMessage(card_id, expected_version, result.actualVersion));
      }
      return { content: [{ type: "text", text: JSON.stringify(result.card) }] };
    }
  );

  // delete_card
  server.tool(
    "delete_card",
    "Delete a card permanently. Every tree node of this card (symlinks included) is removed together with the whole subtree below each of them. A card whose only canonical node is in the deleted range is permanently deleted together with every symlink node of it elsewhere (and the nodes below those symlinks). Another card with two or more canonical nodes does not follow its symlinks elsewhere, and one with only symlink nodes has no canonical node to follow; either one stays as long as one of its nodes remains outside the range. This cannot be undone. To keep a card that sits in the range, move its canonical node out first (move_node). Returns JSON { deleted: true, deleted_card_ids, deleted_node_count, deleted_link_count }: deleted_card_ids lists every card this call deleted permanently (the card itself and the other cards in the range), deleted_node_count the nodes removed, deleted_link_count the symlink nodes removed in other places, outside the subtrees of this card's own nodes (the nodes below such a link are not counted). Pass dry_run: true to see deleted_card_ids and deleted_link_count without deleting anything.",
    {
      card_id: uuidSchema.describe("card_id (card content, shown as card: in compile_subtree output) to delete permanently. Not a node_id; to delete one tree node use delete_node."),
      dry_run: z.boolean().optional().describe(DRY_RUN_DESCRIPTION),
    },
    async ({ card_id, dry_run }) => {
      const dryRun = dry_run === true;
      const summary = dryRun ? await previewCardDeletion(card_id) : await deleteCard(card_id);
      if (!summary) throw await cardNotFound(card_id);
      return deletionResultContent(summary, dryRun);
    }
  );

  // get_backlinks
  server.tool(
    "get_backlinks",
    "Find all cards that reference this card in their references[] field. Returns an array of referencing cards with their full data. Useful for discovering related knowledge.",
    { card_id: uuidSchema.describe("card_id (card content, shown as card: in compile_subtree output) to find backlinks for. Not a node_id.") },
    async ({ card_id }) => {
      const links = await getBacklinks(card_id);
      return { content: [{ type: "text", text: JSON.stringify(links) }] };
    }
  );
}
