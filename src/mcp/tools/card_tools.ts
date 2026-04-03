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
    "Create a new card and its tree node. Returns the card object with node_id. A 'structure' card organizes hierarchy (folder-like); a 'knowledge' card holds atomic content.",
    {
      card_type: z.enum(["structure", "knowledge"]).describe("'structure' for hierarchy/folder nodes, 'knowledge' for content-bearing cards."),
      title: z.string().max(50).describe("Card title (max 50 chars)."),
      content: z.string().optional().describe("Card body text (markdown). Null for structure cards."),
      parent_node_id: z.string().uuid().optional().describe("Place under this parent node. Omit to create at root level."),
      position: z.number().int().optional().describe("0-based position among siblings. Omit to append at end."),
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
    "Get a card by its UUID. Returns all card fields including title, content, tags, references, timestamps, and version.",
    { card_id: z.string().uuid().describe("The card UUID to retrieve.") },
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
    "Update card fields (partial update — only provided fields are changed). When content is modified, content_timestamp is automatically set to now. Use expected_version for optimistic concurrency: if the card's current version differs, the update is rejected with a VersionConflict error.",
    {
      card_id: z.string().uuid().describe("The card UUID to update."),
      title: z.string().max(50).optional().describe("New title (max 50 chars)."),
      content: z.string().nullable().optional().describe("New content. Pass null to clear."),
      tags: z.array(z.string()).optional().describe("Replace all tags with this array."),
      references: z.array(z.string().uuid()).optional().describe("Replace all references with these card UUIDs."),
      content_timestamp: z.string().optional().describe("Override the auto-set content timestamp (ISO format)."),
      source_type: z.string().nullable().optional().describe("Update origin type. Null to clear."),
      source_ref: z.string().nullable().optional().describe("Update origin reference. Null to clear."),
      expected_version: z.number().int().optional().describe("Optimistic lock: reject if card.version ≠ this value."),
    },
    async (args) => {
      const { card_id, expected_version, ...input } = args;
      const result = await updateCard(agentId, card_id, input, expected_version);
      if (!result) {
        return { content: [{ type: "text", text: `Card not found: ${card_id}` }], isError: true };
      }
      if (result.conflict) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "VersionConflict", actualVersion: result.actualVersion }) }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(result.card) }] };
    }
  );

  // delete_card
  server.tool(
    "delete_card",
    "Delete a card and all its tree nodes (including symlinks). This is permanent. To remove only a tree node while keeping the card, use delete_node instead.",
    { card_id: z.string().uuid().describe("The card UUID to delete permanently.") },
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
    { card_id: z.string().uuid().describe("The card UUID to find backlinks for.") },
    async ({ card_id }) => {
      const links = await getBacklinks(card_id);
      return { content: [{ type: "text", text: JSON.stringify(links) }] };
    }
  );
}
