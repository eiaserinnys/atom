import { deleteTreeAndOrphanCards } from "./node-deletion.service.js";
import type { Queryable } from "../db/queryable.js";
import type {
  AtomPatchEvent,
  BatchDeleteItem,
  BatchOpResult,
} from "../shared/types.js";

interface ProcessBatchDeletesContext {
  db: Queryable;
  deletes: BatchDeleteItem[];
  result: BatchOpResult;
  patches: AtomPatchEvent[];
  actor: string | null;
}

export async function processBatchDeletes({
  db,
  deletes,
  result,
  patches,
  actor,
}: ProcessBatchDeletesContext): Promise<void> {
  for (const item of deletes) {
    await deleteBatchCard(db, item, result, patches, actor);
  }
}

async function deleteBatchCard(
  db: Queryable,
  item: BatchDeleteItem,
  result: BatchOpResult,
  patches: AtomPatchEvent[],
  actor: string | null
): Promise<void> {
  const deletion = await deleteTreeAndOrphanCards(db, { cardId: item.card_id });
  const requestedCard = deletion.deletedCards.find((card) => card.cardId === item.card_id);

  result.deleted.push(item.card_id);
  patches.push({
    type: "card:deleted",
    cardId: item.card_id,
    nodeIds: requestedCard?.nodeIds ?? [],
    parentNodeIds: requestedCard?.parentNodeIds ?? [],
    actor,
  });

  for (const card of deletion.deletedCards) {
    if (card.cardId === item.card_id) continue;
    patches.push({
      type: "card:deleted",
      cardId: card.cardId,
      nodeIds: card.nodeIds,
      parentNodeIds: card.parentNodeIds,
      actor,
    });
  }
}
