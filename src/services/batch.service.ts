import { getPool } from "../db/client.js";
import {
  insertCard,
  updateCardById,
  deleteCardById,
} from "../db/queries/cards.js";
import { insertNode, moveNode } from "../db/queries/tree.js";
import type {
  BatchOpInput,
  BatchOpResult,
  BatchCreatedItem,
  BatchCreateItem,
} from "../shared/types.js";
import { eventBus } from "../events/eventBus.js";

// Temporary position bases for the park-and-assign strategy in batch moves.
// These must be within PostgreSQL INTEGER range (-2,147,483,648 to 2,147,483,647)
// and far enough apart to avoid collisions between group and non-group parking.
const GROUP_PARK_BASE = -2_000_000_000;
const NONGROUP_PARK_BASE = -1_000_000_000;

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

  const pool = getPool();
  const client = await pool.connect();

  const result: BatchOpResult = {
    created: [],
    symlinked: [],
    updated: [],
    moved: [],
    deleted: [],
  };

  try {
    await client.query("BEGIN");

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
      for (const item of input.symlinks) {
        const node = await insertNode(
          client,
          item.card_id,
          item.parent_node_id,
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

    // ── Moves ─────────────────────────────────────────────────────────────────
    if (input.moves && input.moves.length > 0) {
      // Build temp_id → node_id map from this batch's creates
      const tempIdToNodeId = new Map<string, string>(
        result.created.map((c) => [c.temp_id, c.node_id])
      );

      // Resolve parent_temp_id references and group by target parent
      const resolvedMoves: Array<{
        node_id: string;
        parent_node_id: string | null;
        new_position: number | undefined;
      }> = [];

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
        resolvedMoves.push({
          node_id: item.node_id,
          parent_node_id: newParentNodeId ?? null,
          new_position: item.new_position,
        });
      }

      // Group moves by target parent to detect same-parent multi-moves
      const movesByParent = new Map<string | null, typeof resolvedMoves>();
      for (const m of resolvedMoves) {
        const key = m.parent_node_id;
        if (!movesByParent.has(key)) movesByParent.set(key, []);
        movesByParent.get(key)!.push(m);
      }

      for (const [parentId, group] of movesByParent) {
        if (group.length <= 1) {
          // Single move — use existing moveNode (handles retry/renumber)
          await moveNode(
            client,
            group[0].node_id,
            parentId,
            group[0].new_position
          );
        } else {
          // Multi-move to same parent: park-and-assign strategy.
          // Phase 1: Park all group nodes at unique negative positions
          // to clear them from the positive position space.
          for (let i = 0; i < group.length; i++) {
            await client.query(
              `UPDATE tree_nodes SET parent_node_id = $1, position = $2 WHERE id = $3`,
              [parentId, GROUP_PARK_BASE + i, group[i].node_id]
            );
          }

          // Phase 2: Resolve undefined positions (append-to-end semantics)
          // Track the running max so multiple undefined positions don't collide.
          const maxResult = await client.query(
            `SELECT COALESCE(MAX(position), 0) AS max_pos FROM tree_nodes
             WHERE parent_node_id IS NOT DISTINCT FROM $1 AND position >= 0`,
            [parentId]
          );
          let runningMax = maxResult.rows[0]["max_pos"] as number;
          // Also consider explicitly provided positions
          for (const item of group) {
            if (
              item.new_position !== undefined &&
              item.new_position > runningMax
            ) {
              runningMax = item.new_position;
            }
          }
          for (const item of group) {
            if (item.new_position === undefined) {
              runningMax += 100;
              item.new_position = runningMax;
            }
          }

          // Phase 3: Relocate non-group siblings if any requested positions
          // conflict with them. Without this, a UNIQUE violation would occur
          // when assigning final positions to group nodes.
          const requestedPositionSet = new Set(
            group.map((g) => g.new_position!)
          );
          const nonGroupSiblings = await client.query(
            `SELECT id FROM tree_nodes
             WHERE parent_node_id IS NOT DISTINCT FROM $1 AND position >= 0
             ORDER BY position ASC`,
            [parentId]
          );
          if (nonGroupSiblings.rows.length > 0) {
            // Park non-group siblings at temporary positions, then
            // reassign them to positions that don't collide with
            // the group's requested positions.
            for (let i = 0; i < nonGroupSiblings.rows.length; i++) {
              await client.query(
                `UPDATE tree_nodes SET position = $1 WHERE id = $2`,
                [NONGROUP_PARK_BASE + i, nonGroupSiblings.rows[i]["id"]]
              );
            }
            let pos = 100;
            for (const row of nonGroupSiblings.rows) {
              while (requestedPositionSet.has(pos)) pos += 100;
              await client.query(
                `UPDATE tree_nodes SET position = $1 WHERE id = $2`,
                [pos, row["id"]]
              );
              pos += 100;
            }
          }

          // Phase 4: Assign final positions to group nodes in ascending order.
          // Both group nodes (parked at large negatives) and non-group siblings
          // (relocated to avoid conflicts) are now safe from collisions.
          group.sort((a, b) => a.new_position! - b.new_position!);
          for (const item of group) {
            await client.query(
              `UPDATE tree_nodes SET position = $1 WHERE id = $2`,
              [item.new_position, item.node_id]
            );
          }
        }

        for (const item of group) {
          result.moved.push(item.node_id);
        }
      }
    }

    // ── Deletes ───────────────────────────────────────────────────────────────
    if (input.deletes && input.deletes.length > 0) {
      for (const item of input.deletes) {
        await deleteCardById(client, item.card_id);
        result.deleted.push(item.card_id);
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // Emit a single batch event after the transaction commits
  eventBus.emit("atom:event", { type: "batch:completed", result });

  return result;
}
