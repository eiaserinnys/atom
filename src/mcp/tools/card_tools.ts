import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createCard,
  getCard,
  updateCard,
  deleteCard,
  getBacklinks,
} from "../../services/card.service.js";

export function registerCardTools(server: McpServer): void {
  // create_card
  server.tool(
    "create_card",
    "Create a new card. If parent_node_id is omitted, created as a root tree node.",
    {
      card_type: z.enum(["structure", "knowledge"]),
      title: z.string().max(50),
      content: z.string().optional(),
      parent_node_id: z.string().uuid().optional(),
      position: z.number().int().optional(),
      tags: z.array(z.string()).optional(),
      references: z.array(z.string().uuid()).optional(),
      content_timestamp: z.string().optional(),
      source_type: z.string().optional(),
      source_ref: z.string().optional(),
    },
    async (args) => {
      const { card, node_id } = await createCard({
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
    "Get a card by UUID.",
    { card_id: z.string().uuid() },
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
    "Update card fields. content changes auto-update content_timestamp.",
    {
      card_id: z.string().uuid(),
      title: z.string().max(50).optional(),
      content: z.string().nullable().optional(),
      tags: z.array(z.string()).optional(),
      references: z.array(z.string().uuid()).optional(),
      content_timestamp: z.string().optional(),
      source_type: z.string().nullable().optional(),
      source_ref: z.string().nullable().optional(),
    },
    async (args) => {
      const { card_id, ...input } = args;
      const updated = await updateCard(card_id, input);
      if (!updated) {
        return { content: [{ type: "text", text: `Card not found: ${card_id}` }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(updated) }] };
    }
  );

  // delete_card
  server.tool(
    "delete_card",
    "Delete a card and all its tree nodes.",
    { card_id: z.string().uuid() },
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
    "Get cards that reference this card via their references[] field.",
    { card_id: z.string().uuid() },
    async ({ card_id }) => {
      const links = await getBacklinks(card_id);
      return { content: [{ type: "text", text: JSON.stringify(links) }] };
    }
  );
}
