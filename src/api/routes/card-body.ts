import { InvalidInputError } from "../../services/service-errors.js";
import type { CardType, CreateCardInput, UpdateCardInput } from "../../shared/types.js";

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

const UPDATE_CARD_FIELDS = [
  "title", "content", "tags", "references", "content_timestamp", "source_type", "source_ref", "expected_version",
] as const;

function expectType(field: string, ok: boolean, expected: string): void {
  if (!ok) throw new InvalidInputError(`${field} must be ${expected}`);
}

/**
 * The update-card body of PATCH /api/cards/:cardId: the same fields as MCP update_card.
 * Title and UUID-array rules live in the card service.
 */
export function parseUpdateCardBody(rawBody: unknown): { input: UpdateCardInput; expectedVersion: number | undefined } {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    throw new InvalidInputError("Request body must be a JSON object");
  }
  const body = rawBody as Record<string, unknown>;
  const unknown = Object.keys(body).filter((key) => !(UPDATE_CARD_FIELDS as readonly string[]).includes(key));
  if (unknown.length > 0) {
    throw new InvalidInputError(`Unknown card update field: ${unknown.join(", ")} (allowed: ${UPDATE_CARD_FIELDS.join(", ")})`);
  }
  const nullableString = (field: string) => {
    const value = body[field];
    expectType(field, value === undefined || value === null || typeof value === "string", "a string or null");
    return value as string | null | undefined;
  };
  const { tags, content_timestamp: contentTimestamp, expected_version: expectedVersion } = body;
  expectType("references", !("references" in body) || (Array.isArray(body["references"])), "an array of UUIDs");
  expectType("tags", tags === undefined || (Array.isArray(tags) && tags.every((tag) => typeof tag === "string")), "an array of strings");
  expectType("content_timestamp", contentTimestamp === undefined || typeof contentTimestamp === "string", "a string");
  expectType("expected_version", expectedVersion === undefined || Number.isInteger(expectedVersion), "an integer");

  const input: UpdateCardInput = {};
  if ("title" in body) input.title = body["title"] as string;
  if ("references" in body) input.references = body["references"] as string[];
  if (tags !== undefined) input.tags = tags as string[];
  if (contentTimestamp !== undefined) input.content_timestamp = contentTimestamp as string;
  for (const field of ["content", "source_type", "source_ref"] as const) {
    const value = nullableString(field);
    if (value !== undefined) input[field] = value;
  }
  return { input, expectedVersion: expectedVersion as number | undefined };
}
