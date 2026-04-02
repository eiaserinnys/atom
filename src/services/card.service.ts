import { getPool } from "../db/client.js";
import pg from "pg";
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

export async function createCard(input: CreateCardInput): Promise<{ card: Card; node_id: string }> {
  const pool = getPool();
  const client = await (pool as pg.Pool).connect();
  try {
    await client.query("BEGIN");
    const card = await insertCard(client, input);
    const node = await insertNode(
      client,
      card.id,
      input.parent_node_id ?? null,
      input.position,
      false
    );
    await client.query("COMMIT");

    eventBus.emit("atom:event", {
      type: "card:created",
      cardId: card.id,
      nodeId: node.id,
      parentNodeId: input.parent_node_id ?? null,
      data: card,
    });

    return { card, node_id: node.id };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getCard(id: string): Promise<Card | null> {
  return selectCardById(getPool(), id);
}

export async function updateCard(
  id: string,
  input: UpdateCardInput
): Promise<Card | null> {
  const contentChanged = input.content !== undefined;
  const card = await updateCardById(getPool(), id, input, contentChanged);
  if (card) {
    eventBus.emit("atom:event", { type: "card:updated", cardId: id, data: card });
  }
  return card;
}

export async function deleteCard(id: string): Promise<boolean> {
  // Cascade deletes tree_nodes via FK
  const deleted = await deleteCardById(getPool(), id);
  if (deleted) {
    eventBus.emit("atom:event", { type: "card:deleted", cardId: id });
  }
  return deleted;
}

export async function getBacklinks(cardId: string): Promise<Card[]> {
  const db = getPool();
  const result = await db.query(
    `SELECT * FROM cards WHERE $1 = ANY("references")`,
    [cardId]
  );
  return result.rows;
}

export async function getCardNodes(cardId: string) {
  return selectNodesByCardId(getPool(), cardId);
}
