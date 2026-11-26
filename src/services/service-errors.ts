import { getDb } from "../db/client.js";
import { selectCardById } from "../db/queries/cards.js";
import { selectCanonicalNodeByCardId, selectNodeById } from "../db/queries/tree.js";
import type { Queryable } from "../db/queryable.js";
import { cardTitleProblem } from "../shared/card-title.js";
import { invalidIdMessage, isUuid } from "../shared/uuid.js";

export type ServiceErrorCode =
  | "NODE_NOT_FOUND"
  | "CARD_NOT_FOUND"
  | "PARENT_NOT_FOUND"
  | "INVALID_ID"
  | "INVALID_INPUT"
  | "VERSION_CONFLICT";

/** A failure the caller caused and can fix; REST maps statusCode and code, MCP shows message. */
export class ServiceError extends Error {
  constructor(readonly statusCode: 400 | 404 | 409, readonly code: ServiceErrorCode, message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends ServiceError {
  constructor(code: "NODE_NOT_FOUND" | "CARD_NOT_FOUND" | "PARENT_NOT_FOUND", message: string) {
    super(404, code, message);
  }
}

export class InvalidInputError extends ServiceError {
  constructor(message: string, code: "INVALID_INPUT" | "INVALID_ID" = "INVALID_INPUT") {
    super(400, code, message);
  }
}

export class ConflictError extends ServiceError {
  constructor(message: string) {
    super(409, "VERSION_CONFLICT", message);
  }
}

/**
 * node_id (tree position) and card_id (card content) are both UUIDs and are easy to swap.
 * A not-found message tells which kind the ID really is, when it is the other one.
 */
async function otherKindHint(db: Queryable, id: string, expected: "node_id" | "card_id"): Promise<string> {
  if (!isUuid(id)) return "";
  if (expected === "node_id") {
    const card = await selectCardById(db, id);
    if (!card) return "";
    const node = await selectCanonicalNodeByCardId(db, card.id);
    return `. This ID is a card_id (card content), but this tool takes a node_id (tree position).`
      + (node ? ` The card's node: ${node.id}` : "");
  }
  const node = await selectNodeById(db, id);
  if (!node) return "";
  return `. This ID is a node_id (tree position), but this tool takes a card_id (card content). Its card_id: ${node.card_id}`;
}

export const PARENT_NODE_SUBJECT = "Parent node";

/** `subject` is "Node", "Parent node", or any prefix that reads "<subject> not found". */
export async function nodeNotFound(
  nodeId: string,
  subject = "Node",
  db: Queryable = getDb()
): Promise<NotFoundError> {
  return new NotFoundError(
    subject === PARENT_NODE_SUBJECT ? "PARENT_NOT_FOUND" : "NODE_NOT_FOUND",
    `${subject} not found: ${nodeId}${await otherKindHint(db, nodeId, "node_id")}`
  );
}

export async function cardNotFound(cardId: string, db: Queryable = getDb()): Promise<NotFoundError> {
  return new NotFoundError("CARD_NOT_FOUND", `Card not found: ${cardId}${await otherKindHint(db, cardId, "card_id")}`);
}

export async function assertNodeExists(
  db: Queryable,
  nodeId: string,
  subject = "Node",
  label = "node_id"
): Promise<void> {
  if (!isUuid(nodeId)) throw new InvalidInputError(invalidIdMessage(label, nodeId), "INVALID_ID");
  if (!(await selectNodeById(db, nodeId))) throw await nodeNotFound(nodeId, subject, db);
}

export async function assertCardExists(db: Queryable, cardId: string): Promise<void> {
  if (!isUuid(cardId)) throw new InvalidInputError(invalidIdMessage("card_id", cardId), "INVALID_ID");
  if (!(await selectCardById(db, cardId))) throw await cardNotFound(cardId, db);
}

export function assertUuid(label: string, value: unknown): void {
  if (!isUuid(value)) throw new InvalidInputError(invalidIdMessage(label, value), "INVALID_ID");
}

/** `values` may be absent; when present it must be an array of UUID strings. */
export function assertUuidArray(label: string, values: unknown): void {
  if (values === undefined || values === null) return;
  if (!Array.isArray(values)) throw new InvalidInputError(`${label} must be an array of UUIDs`);
  values.forEach((value, index) => assertUuid(`${label}[${index}]`, value));
}

export function assertValidCardTitle(title: unknown): void {
  const problem = cardTitleProblem(title);
  if (problem) throw new InvalidInputError(problem);
}

export function versionConflictMessage(cardId: string, expectedVersion: number | undefined, actualVersion: number): string {
  return `VersionConflict: card ${cardId} expected version ${expectedVersion}, actual ${actualVersion}. `
    + "Re-read the card with get_card, merge your change into the latest content, "
    + "and retry with its version as expected_version.";
}
