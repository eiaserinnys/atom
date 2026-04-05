import { getDb } from "../db/client.js";
import {
  insertCard,
  selectCardById,
  updateCardById,
  deleteCardById,
} from "../db/queries/cards.js";
import { insertNode, selectNodesByCardId } from "../db/queries/tree.js";
import type {
  Card,
  CreateCardInput,
  UpdateCardInput,
} from "../shared/types.js";
import { eventBus } from "../events/eventBus.js";

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

  const { card, node } = await getDb().transaction(async (client) => {
    const card = await insertCard(client, input, agentId ?? undefined);
    const node = await insertNode(
      client,
      card.id,
      input.parent_node_id ?? null,
      input.position,
      false
    );
    return { card, node };
  });

  eventBus.emit("atom:event", {
    type: "card:created",
    cardId: card.id,
    nodeId: node.id,
    parentNodeId: input.parent_node_id ?? null,
    data: card,
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
  // Overload resolution: support both updateCard(id, input) and updateCard(agentId, id, input, expectedVersion?)
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
    // updateCard(id, input) — legacy call, agentIdOrId is actually the id
    agentId = null;
    id = agentIdOrId as string;
    input = idOrInput;
    expectedVersion = undefined;
  }

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

export async function deleteCard(id: string): Promise<boolean> {
  // Cascade deletes tree_nodes via FK
  const deleted = await deleteCardById(getDb(), id);
  if (deleted) {
    eventBus.emit("atom:event", { type: "card:deleted", cardId: id, actor: null });
  }
  return deleted;
}

export async function getBacklinks(cardId: string): Promise<Card[]> {
  const db = getDb();
  const result = await db.query(
    `SELECT * FROM cards WHERE $1 = ANY("references")`,
    [cardId]
  );
  return result.rows;
}

export async function getCardNodes(cardId: string) {
  return selectNodesByCardId(getDb(), cardId);
}
