import { InvalidInputError } from "../../services/service-errors.js";
import type { CardType, CreateCardInput } from "../../shared/types.js";

const CARD_TYPES: readonly CardType[] = ["structure", "knowledge"];

/** The create-card body shared by POST /cards and POST /api/cards. Title rules live in the card service. */
export function parseCreateCardBody(rawBody: unknown): CreateCardInput {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    throw new InvalidInputError("Request body must be a JSON object");
  }
  const body = rawBody as Record<string, unknown>;
  const cardType = body["card_type"] ?? "knowledge";
  if (!CARD_TYPES.includes(cardType as CardType)) {
    throw new InvalidInputError(`card_type must be one of: ${CARD_TYPES.join(", ")}`);
  }
  return {
    card_type: cardType as CardType,
    title: body["title"] as string,
    content: (body["content"] as string | null) ?? null,
    parent_node_id: (body["parent_node_id"] as string | null) ?? null,
    position: body["position"] as number | undefined,
    tags: (body["tags"] as string[]) ?? [],
    references: (body["references"] as string[]) ?? [],
    content_timestamp: (body["content_timestamp"] as string | null) ?? null,
    source_type: (body["source_type"] as string | null) ?? null,
    source_ref: (body["source_ref"] as string | null) ?? null,
  };
}
