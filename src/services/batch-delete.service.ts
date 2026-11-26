import { deleteTreeAndOrphanCards } from "./node-deletion.service.js";
import { cardNotFound } from "./service-errors.js";
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
  const requestedIds = [...new Set(deletes.map((item) => item.card_id))];
  const deletedIds = new Set<string>();

  for (const item of deletes) {
    if (deletedIds.has(item.card_id)) continue;

    const deletion = await deleteTreeAndOrphanCards(db, { cardId: item.card_id });
    if (!deletion.deleted) throw await cardNotFound(item.card_id, db);

    for (const card of deletion.deletedCards) {
      deletedIds.add(card.cardId);
      patches.push({
        type: "card:deleted",
        cardId: card.cardId,
        nodeIds: card.nodeIds,
        parentNodeIds: card.parentNodeIds,
        actor,
      });
    }
  }

  result.deleted.push(...requestedIds.filter((cardId) => deletedIds.has(cardId)));
  result.cascade_deleted_card_ids.push(
    ...[...deletedIds].filter((cardId) => !requestedIds.includes(cardId))
  );
}
