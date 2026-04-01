import { getPool } from "../db/client.js";
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

export async function createCard(input: CreateCardInput): Promise<{ card: Card; node_id: string }> {
  const db = getPool();

  const card = await insertCard(db, input);
  const node = await insertNode(
    db,
    card.id,
    input.parent_node_id ?? null,
    input.position,
    false
  );

  return { card, node_id: node.id };
}

export async function getCard(id: string): Promise<Card | null> {
  return selectCardById(getPool(), id);
}

export async function updateCard(
  id: string,
  input: UpdateCardInput
): Promise<Card | null> {
  const contentChanged = input.content !== undefined;
  return updateCardById(getPool(), id, input, contentChanged);
}

export async function deleteCard(id: string): Promise<boolean> {
  // Cascade deletes tree_nodes via FK
  return deleteCardById(getPool(), id);
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
