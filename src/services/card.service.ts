import { getDb } from "../db/client.js";
import {
  CARD_COLUMNS,
  CARD_COLUMN_LIST,
  insertCard,
  rowToCard,
  selectCardById,
  updateCardById,
} from "../db/queries/cards.js";
import { insertNode, selectNodesByCardId } from "../db/queries/tree.js";
import type {
  Card,
  CreateCardInput,
  UpdateCardInput,
} from "../shared/types.js";
import { eventBus } from "../events/eventBus.js";
import { deserializeArray, deserializeBoolean } from "../db/utils.js";
import { toTreeNodeWithCard } from "./tree-node-payload.js";
import {
  deleteTreeAndOrphanCards,
  planTreeDeletion,
  summarizeDeletion,
  type DeletionSummary,
} from "./node-deletion.service.js";
import { resolveWriteParentNodeId } from "./tree-parent.js";
import { assertUuidArray, assertValidCardTitle, cardNotFound } from "./service-errors.js";

export async function createCard(
  agentIdOrInput: string | null | CreateCardInput,
  inputOrUndefined?: CreateCardInput
): Promise<{ card: Card; node_id: string }> {
  // Overload resolution: support both createCard(input) and createCard(agentId, input)
  let agentId: string | null;
  let input: CreateCardInput;
  if (typeof agentIdOrInput === 'string' || agentIdOrInput === null) {
    agentId = agentIdOrInput;
    input = inputOrUndefined!;
  } else {
    agentId = null;
    input = agentIdOrInput;
  }

  assertValidCardTitle(input.title);
  assertUuidArray("references", input.references);
  const { card, node } = await getDb().transaction(async (client) => {
    const parentNodeId = await resolveWriteParentNodeId(
      client,
      input.parent_node_id ?? null
    );
    const card = await insertCard(client, input, agentId ?? undefined);
    const node = await insertNode(
      client,
      card.id,
      parentNodeId,
      input.position,
      false
    );
    return { card, node };
  });

  eventBus.emit("atom:event", {
    type: "card:created",
    cardId: card.id,
    nodeId: node.id,
    parentNodeId: node.parent_node_id,
    data: card,
    node: await toTreeNodeWithCard(getDb(), node),
    actor: agentId,
  });

  return { card, node_id: node.id };
}

export async function getCard(id: string): Promise<Card | null> {
  return selectCardById(getDb(), id);
}

export type UpdateCardServiceResult =
  | { card: Card; conflict: false }
  | { conflict: true; actualVersion: number }
  | null;

export async function updateCard(
  agentIdOrId: string | null,
  idOrInput: string | UpdateCardInput,
  inputOrExpected?: UpdateCardInput | number,
  expectedVersionOrUndefined?: number
): Promise<UpdateCardServiceResult> {
  // Support updateCard(id, input, expectedVersion?) and updateCard(agentId, id, input, expectedVersion?).
  let agentId: string | null;
  let id: string;
  let input: UpdateCardInput;
  let expectedVersion: number | undefined;

  if (typeof idOrInput === 'string') {
    // updateCard(agentId, id, input, expectedVersion?)
    agentId = agentIdOrId;
    id = idOrInput;
    input = inputOrExpected as UpdateCardInput;
    expectedVersion = expectedVersionOrUndefined;
  } else {
    // Legacy call: agentIdOrId is the card id.
    agentId = null;
    id = agentIdOrId as string;
    input = idOrInput;
    expectedVersion = inputOrExpected as number | undefined;
  }

  if (input.title !== undefined) assertValidCardTitle(input.title);
  assertUuidArray("references", input.references);
  const contentChanged = input.content !== undefined;
  const result = await updateCardById(
    getDb(), id, input, contentChanged, agentId ?? undefined, expectedVersion
  );

  if (!result) return null;
  if (result.conflict) return result;

  eventBus.emit("atom:event", {
    type: "card:updated",
    cardId: id,
    data: result.card,
    actor: agentId,
  });
  return result;
}

export async function deleteCard(id: string): Promise<DeletionSummary | null> {
  const result = await getDb().transaction((client) =>
    deleteTreeAndOrphanCards(client, { cardId: id })
  );
  if (!result.deleted) return null;
  for (const card of result.deletedCards) {
    eventBus.emit("atom:event", {
      type: "card:deleted",
      cardId: card.cardId,
      nodeIds: card.nodeIds,
      parentNodeIds: card.parentNodeIds,
      actor: null,
    });
  }
  return {
    deletedCardIds: result.deletedCards.map((card) => card.cardId),
    deletedNodeCount: result.deletedNodeCount,
  };
}

export async function previewCardDeletion(id: string): Promise<DeletionSummary | null> {
  const plan = await planTreeDeletion(getDb(), { cardId: id });
  return plan ? summarizeDeletion(plan) : null;
}

export async function getBacklinks(cardId: string): Promise<Card[]> {
  const db = getDb();
  if (!(await selectCardById(db, cardId))) throw await cardNotFound(cardId, db);
  let result;
  if (db.dbType === 'sqlite') {
    result = await db.query(
      `SELECT ${CARD_COLUMNS.map((column) => `c.${column}`).join(", ")} FROM cards c, json_each(c."references") je
       WHERE je.value = $1`,
      [cardId]
    );
  } else {
    result = await db.query(
      `SELECT ${CARD_COLUMN_LIST} FROM cards WHERE $1 = ANY("references")`,
      [cardId]
    );
  }
  return result.rows.map(rowToCard);
}

export async function getCardNodes(cardId: string) {
  return selectNodesByCardId(getDb(), cardId);
}
