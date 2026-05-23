import { deleteCardById } from "../db/queries/cards.js";
import { selectNodesByCardId } from "../db/queries/tree.js";
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
  const nodes = await selectNodesByCardId(db, item.card_id);

  // Cascade semantics live in the DB constraints. The batch patch records the
  // direct nodes of the deleted card as they existed before the cascade runs.
  await deleteCardById(db, item.card_id);

  result.deleted.push(item.card_id);
  patches.push({
    type: "card:deleted",
    cardId: item.card_id,
    nodeIds: nodes.map((node) => node.id),
    parentNodeIds: nodes.map((node) => node.parent_node_id),
    actor,
  });
}
