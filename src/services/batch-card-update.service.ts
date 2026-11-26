import { updateCardById } from "../db/queries/cards.js";
import type { Queryable } from "../db/queryable.js";
import {
  assertValidCardTitle,
  cardNotFound,
  ConflictError,
  versionConflictMessage,
} from "./service-errors.js";
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
  if (fields.title !== undefined) assertValidCardTitle(fields.title);
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
    throw await cardNotFound(cardId, db);
  }
  if (updateResult.conflict) {
    throw new ConflictError(versionConflictMessage(cardId, expectedVersion, updateResult.actualVersion));
  }

  result.updated.push(cardId);
  patches.push({
    type: "card:updated",
    cardId,
    data: updateResult.card,
    actor,
  });
}
