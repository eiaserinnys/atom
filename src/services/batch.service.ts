import { getDb } from "../db/client.js";
import {
  insertCard,
  updateCardById,
  deleteCardById,
} from "../db/queries/cards.js";
import { insertNode, moveNode, updateNodeProperties } from "../db/queries/tree.js";
import type {
  BatchOpInput,
  BatchOpResult,
  BatchCreatedItem,
  BatchCreateItem,
} from "../shared/types.js";
import { eventBus } from "../events/eventBus.js";

// ---------------------------------------------------------------------------
// Topological sort for creates
// ---------------------------------------------------------------------------

/**
 * Returns creates in an order where every item's parent_temp_id dependency
 * appears before the item itself.
 *
 * Throws if a circular dependency is detected.
 */
export function topologicalSortCreates(
  creates: BatchCreateItem[]
): BatchCreateItem[] {
  const byTempId = new Map<string, BatchCreateItem>(
    creates.map((c) => [c.temp_id, c])
  );

  const visited = new Set<string>();
  const inStack = new Set<string>(); // cycle detection
  const sorted: BatchCreateItem[] = [];

  function visit(item: BatchCreateItem): void {
    if (visited.has(item.temp_id)) return;

    if (inStack.has(item.temp_id)) {
      throw new Error(
        `Circular parent_temp_id dependency detected at temp_id "${item.temp_id}"`
      );
    }

    inStack.add(item.temp_id);

    if (item.parent_temp_id !== undefined) {
      const parent = byTempId.get(item.parent_temp_id);
      if (!parent) {
        throw new Error(
          `parent_temp_id "${item.parent_temp_id}" referenced by "${item.temp_id}" not found in creates`
        );
      }
      visit(parent);
    }

    inStack.delete(item.temp_id);
    visited.add(item.temp_id);
    sorted.push(item);
  }

  for (const item of creates) {
    visit(item);
  }

  return sorted;
}

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

  const result = await getDb().transaction(async (client) => {
    const result: BatchOpResult = {
      created: [],
      symlinked: [],
      updated: [],
      node_updated: [],
      moved: [],
      deleted: [],
    };

    // ── Creates ──────────────────────────────────────────────────────────────
    if (input.creates && input.creates.length > 0) {
      const sorted = topologicalSortCreates(input.creates);

      // temp_id → resolved node_id (for parent_temp_id resolution)
      const tempIdToNodeId = new Map<string, string>();

      for (const item of sorted) {
        // Resolve parent node ID
        let parentNodeId: string | null = item.parent_node_id ?? null;
        if (item.parent_temp_id !== undefined) {
          const resolved = tempIdToNodeId.get(item.parent_temp_id);
          if (resolved === undefined) {
            // Should never happen after topological sort, but guard anyway
            throw new Error(
              `Internal error: resolved node_id not found for temp_id "${item.parent_temp_id}"`
            );
          }
          parentNodeId = resolved;
        }

        const card = await insertCard(client, {
          card_type: item.card_type,
          title: item.title,
          content: item.content ?? null,
          tags: item.tags ?? [],
          references: item.references ?? [],
          content_timestamp: item.content_timestamp ?? null,
          source_type: item.source_type ?? null,
          source_ref: item.source_ref ?? null,
        }, agentId ?? undefined);

        const node = await insertNode(
          client,
          card.id,
          parentNodeId,
          item.position,
          false
        );

        tempIdToNodeId.set(item.temp_id, node.id);
        result.created.push({
          temp_id: item.temp_id,
          card_id: card.id,
          node_id: node.id,
        });
      }
    }

    // ── Symlinks ─────────────────────────────────────────────────────────────
    if (input.symlinks && input.symlinks.length > 0) {
      // Build temp_id → node_id map from this batch's creates (same pattern as moves)
      const symlinkTempIdToNodeId = new Map<string, string>(
        result.created.map((c) => [c.temp_id, c.node_id])
      );

      for (const item of input.symlinks) {
        let parentNodeId: string | null = item.parent_node_id ?? null;
        if (item.parent_temp_id !== undefined) {
          const resolved = symlinkTempIdToNodeId.get(item.parent_temp_id);
          if (resolved === undefined) {
            throw new Error(
              `Symlink: parent_temp_id "${item.parent_temp_id}" not found among batch creates`
            );
          }
          parentNodeId = resolved;
        }
        const node = await insertNode(
          client,
          item.card_id,
          parentNodeId,
          item.position,
          true
        );
        result.symlinked.push(node.id);
      }
    }

    // ── Updates ──────────────────────────────────────────────────────────────
    if (input.updates && input.updates.length > 0) {
      for (const item of input.updates) {
        const { card_id, expected_version, ...fields } = item;
        const contentChanged = fields.content !== undefined;
        const updateResult = await updateCardById(
          client, card_id, fields, contentChanged, agentId ?? undefined, expected_version
        );
        if (updateResult === null) {
          throw new Error(`Card not found: ${card_id}`);
        }
        if (updateResult.conflict) {
          throw new Error(
            `VersionConflict: card ${card_id} expected version ${expected_version}, actual ${updateResult.actualVersion}`
          );
        }
        result.updated.push(card_id);
      }
    }

    // ── Node updates ─────────────────────────────────────────────────────────
    // Tree-node property updates (journal_limit). DB-query direct call on purpose:
    // the aggregate `batch:completed` event covers batch consumers; we don't
    // emit per-node `node:updated` here, matching the pattern of updates/moves/
    // deletes/symlinks above which also skip per-item events.
    if (input.node_updates && input.node_updates.length > 0) {
      for (const item of input.node_updates) {
        const { node_id, ...props } = item;
        // `updated` is the canonical partial-update signal from the DB layer
        // (see `db/queries/tree.ts` updateNodeProperties). A no-op item must
        // not be reported as a successful update — symmetric with the
        // standalone update_node({node_id}) omit path which also stays silent.
        const { node, updated } = await updateNodeProperties(client, node_id, props);
        if (node === null) {
          throw new Error(`Node not found: ${node_id}`);
        }
        if (updated) {
          result.node_updated.push(node_id);
        }
      }
    }

    // ── Moves ─────────────────────────────────────────────────────────────────
    //
    // Cycle A2: park-and-assign 4-phase logic removed. After A1's UNIQUE
    // relaxation on (parent_node_id, position), explicit position
    // collisions are allowed and resolved deterministically by the
    // (position, id) tie-break in selectChildren. Callers needing
    // automatic collision avoidance will use cycle B's `before/after`
    // MCP interface; the absolute-position path here just writes what
    // the caller asks for. Same-parent multi-moves degenerate to
    // sequential moveNode calls.
    //
    // Incident c88f3fed closed by this simplification — the original
    // "position conflict persists after 3 retries" failure mode is
    // structurally impossible now (no UNIQUE, no retry loop).
    if (input.moves && input.moves.length > 0) {
      // Build temp_id → node_id map from this batch's creates
      const tempIdToNodeId = new Map<string, string>(
        result.created.map((c) => [c.temp_id, c.node_id])
      );

      for (const item of input.moves) {
        let newParentNodeId: string | null | undefined = item.new_parent_node_id;
        if (item.parent_temp_id !== undefined) {
          const resolved = tempIdToNodeId.get(item.parent_temp_id);
          if (resolved === undefined) {
            throw new Error(
              `Move: parent_temp_id "${item.parent_temp_id}" not found among batch creates`
            );
          }
          newParentNodeId = resolved;
        }
        await moveNode(
          client,
          item.node_id,
          newParentNodeId ?? null,
          item.new_position
        );
        result.moved.push(item.node_id);
      }
    }

    // ── Deletes ───────────────────────────────────────────────────────────────
    if (input.deletes && input.deletes.length > 0) {
      for (const item of input.deletes) {
        await deleteCardById(client, item.card_id);
        result.deleted.push(item.card_id);
      }
    }

    return result;
  });

  // Emit a single batch event after the transaction commits
  eventBus.emit("atom:event", { type: "batch:completed", result });

  return result;
}
