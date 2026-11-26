import type { BatchOpInput } from "../shared/types.js";
import { assertUuid, assertUuidArray } from "./service-errors.js";

/**
 * Rejects malformed IDs in every ID field of a batch before the transaction
 * opens, so a bad entry never reaches the database and nothing is applied.
 * Whether an ID exists is each processor's job; deletes get the format check only.
 */
export function assertBatchIdsWellFormed(input: BatchOpInput): void {
  input.creates?.forEach((item, i) => assertUuidArray(`creates[${i}].references`, item.references));
  input.updates?.forEach((item, i) => {
    assertUuid(`updates[${i}].card_id`, item.card_id);
    assertUuidArray(`updates[${i}].references`, item.references);
  });
  input.node_updates?.forEach((item, i) => assertUuid(`node_updates[${i}].node_id`, item.node_id));
  input.moves?.forEach((item, i) => assertUuid(`moves[${i}].node_id`, item.node_id));
  input.child_orders?.forEach((item, i) => assertUuidArray(`child_orders[${i}].order`, item.order));
  input.deletes?.forEach((item, i) => assertUuid(`deletes[${i}].card_id`, item.card_id));
}
