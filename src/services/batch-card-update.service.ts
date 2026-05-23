import { updateCardById } from "../db/queries/cards.js";
import type { Queryable } from "../db/queryable.js";
import type {
  AtomPatchEvent,
  BatchOpResult,
  BatchUpdateItem,
} from "../shared/types.js";

interface ProcessBatchCardUpdatesContext {
  db: Queryable;
  updates: BatchUpdateItem[];
  result: BatchOpResult;
  patches: AtomPatchEvent[];
  actor: string | null;
}

export async function processBatchCardUpdates({
  db,
  updates,
  result,
  patches,
  actor,
}: ProcessBatchCardUpdatesContext): Promise<void> {
  for (const item of updates) {
    await updateBatchCard(db, item, result, patches, actor);
  }
}

async function updateBatchCard(
  db: Queryable,
  item: BatchUpdateItem,
  result: BatchOpResult,
  patches: AtomPatchEvent[],
  actor: string | null
): Promise<void> {
  const { card_id: cardId, expected_version: expectedVersion, ...fields } = item;
  const contentChanged = fields.content !== undefined;
  const updateResult = await updateCardById(
    db,
    cardId,
    fields,
    contentChanged,
    actor ?? undefined,
    expectedVersion
  );
  if (updateResult === null) {
    throw new Error(`Card not found: ${cardId}`);
  }
  if (updateResult.conflict) {
    throw new Error(
      `VersionConflict: card ${cardId} expected version ${expectedVersion}, actual ${updateResult.actualVersion}`
    );
  }

  result.updated.push(cardId);
  patches.push({
    type: "card:updated",
    cardId,
    data: updateResult.card,
    actor,
  });
}
