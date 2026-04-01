import { getPool } from "../db/client.js";
import {
  insertCard,
  updateCardById,
  deleteCardById,
} from "../db/queries/cards.js";
import { insertNode, moveNode } from "../db/queries/tree.js";
import type {
  BatchWriteInput,
  BatchWriteResult,
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
// executeBatchWrite
// ---------------------------------------------------------------------------

export async function executeBatchWrite(
  input: BatchWriteInput
): Promise<BatchWriteResult> {
  const pool = getPool();
  const client = await pool.connect();

  const result: BatchWriteResult = {
    created: [],
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
        });

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

    // ── Updates ──────────────────────────────────────────────────────────────
    if (input.updates && input.updates.length > 0) {
      for (const item of input.updates) {
        const { card_id, ...fields } = item;
        const contentChanged = fields.content !== undefined;
        await updateCardById(client, card_id, fields, contentChanged);
        result.updated.push(card_id);
      }
    }

    // ── Moves ─────────────────────────────────────────────────────────────────
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
