import { getDb } from "../db/client.js";
import type {
  AtomPatchEvent,
  BatchOpInput,
  BatchOpResult,
} from "../shared/types.js";
import { eventBus } from "../events/eventBus.js";
import {
  processBatchCreates,
  processBatchSymlinks,
} from "./batch-create-symlink.service.js";
import { processBatchMoves } from "./batch-move.service.js";
import { processBatchChildOrders } from "./batch-child-order.service.js";
import { processBatchNodeUpdates } from "./batch-node-update.service.js";
import { processBatchDeletes } from "./batch-delete.service.js";
import { processBatchCardUpdates } from "./batch-card-update.service.js";

export { topologicalSortCreates } from "./batch-create-symlink.service.js";

// ---------------------------------------------------------------------------
// executeBatchOp
// ---------------------------------------------------------------------------

export async function executeBatchOp(
  agentIdOrInput: string | null | BatchOpInput,
  inputOrUndefined?: BatchOpInput
): Promise<BatchOpResult> {
  // Overload resolution: support both executeBatchOp(input) and executeBatchOp(agentId, input)
  let agentId: string | null;
  let input: BatchOpInput;
  if (typeof agentIdOrInput === 'string' || agentIdOrInput === null) {
    agentId = agentIdOrInput;
    input = inputOrUndefined!;
  } else {
    agentId = null;
    input = agentIdOrInput;
  }

  const batchWarnings: string[] = [];
  const { result, patches } = await getDb().transaction(async (client) => {
    const result: BatchOpResult = {
      created: [],
      symlinked: [],
      updated: [],
      node_updated: [],
      moved: [],
      child_ordered: [],
      deleted: [],
    };
    const patches: AtomPatchEvent[] = [];

    // ── Creates ──────────────────────────────────────────────────────────────
    if (input.creates && input.creates.length > 0) {
      await processBatchCreates({
        db: client,
        creates: input.creates,
        result,
        patches,
        actor: agentId,
      });
    }

    // ── Symlinks ─────────────────────────────────────────────────────────────
    if (input.symlinks && input.symlinks.length > 0) {
      await processBatchSymlinks({
        db: client,
        symlinks: input.symlinks,
        created: result.created,
        result,
        patches,
        actor: agentId,
      });
    }

    // ── Updates ──────────────────────────────────────────────────────────────
    if (input.updates && input.updates.length > 0) {
      await processBatchCardUpdates({
        db: client,
        updates: input.updates,
        result,
        patches,
        actor: agentId,
      });
    }

    // ── Node updates ─────────────────────────────────────────────────────────
    // Tree-node property updates (journal_limit). The helper owns the batch
    // no-op policy: a DB-layer no-op is neither a success result nor a patch.
    if (input.node_updates && input.node_updates.length > 0) {
      await processBatchNodeUpdates({
        db: client,
        nodeUpdates: input.node_updates,
        result,
        patches,
        actor: agentId,
      });
    }

    // ── Moves ─────────────────────────────────────────────────────────────────
    //
    // Relative positioning lives in tree-position.service; moveNode (DB query)
    // is a simple UPDATE with pre-resolved parent/key.
    if (input.moves && input.moves.length > 0) {
      await processBatchMoves({
        db: client,
        moves: input.moves,
        created: result.created,
        result,
        patches,
        warnings: batchWarnings,
        actor: agentId,
      });
    }

    // ── Child orders ─────────────────────────────────────────────────────────
    //
    // Reorder listed nodes under a parent with evenly-spaced keys.
    // Nodes in `order` are re-parented if they come from a different parent
    // (implicit cross-parent move). Nodes under the parent but NOT in `order`
    // keep their existing keys (may interleave with new keys via tie-break).
    if (input.child_orders && input.child_orders.length > 0) {
      await processBatchChildOrders({
        db: client,
        childOrders: input.child_orders,
        result,
        patches,
        actor: agentId,
      });
    }

    // ── Deletes ───────────────────────────────────────────────────────────────
    if (input.deletes && input.deletes.length > 0) {
      await processBatchDeletes({
        db: client,
        deletes: input.deletes,
        result,
        patches,
        actor: agentId,
      });
    }

    return { result, patches };
  });

  // Emit a single batch event after the transaction commits
  eventBus.emit("atom:event", { type: "batch:completed", result, patches });

  // Attach deprecation warnings if deprecated position input was used.
  if (batchWarnings.length > 0) {
    return { ...result, _warnings: batchWarnings };
  }
  return result;
}
