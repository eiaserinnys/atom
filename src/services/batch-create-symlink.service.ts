import { insertCard } from "../db/queries/cards.js";
import { insertNode } from "../db/queries/tree.js";
import type { Queryable } from "../db/queryable.js";
import type {
  AtomPatchEvent,
  BatchCreateItem,
  BatchCreatedItem,
  BatchOpResult,
  BatchSymlinkItem,
} from "../shared/types.js";
import { toTreeNodeWithCard } from "./tree-node-payload.js";

interface ProcessBatchCreatesContext {
  db: Queryable;
  creates: BatchCreateItem[];
  result: BatchOpResult;
  patches: AtomPatchEvent[];
  actor: string | null;
}

interface ProcessBatchSymlinksContext {
  db: Queryable;
  symlinks: BatchSymlinkItem[];
  created: BatchCreatedItem[];
  result: BatchOpResult;
  patches: AtomPatchEvent[];
  actor: string | null;
}

interface BatchParentReference {
  parent_node_id?: string | null;
  parent_temp_id?: string;
}

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

export async function processBatchCreates({
  db,
  creates,
  result,
  patches,
  actor,
}: ProcessBatchCreatesContext): Promise<void> {
  const sorted = topologicalSortCreates(creates);
  const tempIdToNodeId = new Map<string, string>();

  for (const item of sorted) {
    const parentNodeId = resolveParentNodeId(
      item,
      tempIdToNodeId,
      (tempId) => `Internal error: resolved node_id not found for temp_id "${tempId}"`
    );

    const card = await insertCard(db, {
      card_type: item.card_type,
      title: item.title,
      content: item.content ?? null,
      tags: item.tags ?? [],
      references: item.references ?? [],
      content_timestamp: item.content_timestamp ?? null,
      source_type: item.source_type ?? null,
      source_ref: item.source_ref ?? null,
    }, actor ?? undefined);

    const node = await insertNode(
      db,
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
    patches.push({
      type: "card:created",
      cardId: card.id,
      nodeId: node.id,
      parentNodeId,
      data: card,
      node: await toTreeNodeWithCard(db, node),
      actor,
    });
  }
}

export async function processBatchSymlinks({
  db,
  symlinks,
  created,
  result,
  patches,
  actor,
}: ProcessBatchSymlinksContext): Promise<void> {
  const tempIdToNodeId = createTempIdToNodeId(created);

  for (const item of symlinks) {
    const parentNodeId = resolveParentNodeId(
      item,
      tempIdToNodeId,
      (tempId) => `Symlink: parent_temp_id "${tempId}" not found among batch creates`
    );

    const node = await insertNode(
      db,
      item.card_id,
      parentNodeId,
      item.position,
      true
    );
    result.symlinked.push(node.id);
    patches.push({
      type: "node:created",
      nodeId: node.id,
      cardId: item.card_id,
      parentNodeId,
      node: await toTreeNodeWithCard(db, node),
      actor,
    });
  }
}

function createTempIdToNodeId(created: BatchCreatedItem[]): Map<string, string> {
  return new Map<string, string>(
    created.map((item) => [item.temp_id, item.node_id])
  );
}

function resolveParentNodeId(
  item: BatchParentReference,
  tempIdToNodeId: Map<string, string>,
  missingTempIdMessage: (tempId: string) => string
): string | null {
  if (item.parent_temp_id !== undefined) {
    const resolved = tempIdToNodeId.get(item.parent_temp_id);
    if (resolved === undefined) {
      throw new Error(missingTempIdMessage(item.parent_temp_id));
    }
    return resolved;
  }

  return item.parent_node_id ?? null;
}
