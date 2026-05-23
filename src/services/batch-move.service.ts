import { moveNode, selectNodeById } from "../db/queries/tree.js";
import type { Queryable } from "../db/queryable.js";
import type {
  AtomPatchEvent,
  BatchCreatedItem,
  BatchMoveItem,
  BatchOpResult,
} from "../shared/types.js";
import { resolvePositionKey } from "./tree-position.service.js";
import { selectChildrenWithCards, toTreeNodeWithCard } from "./tree-node-payload.js";

interface ProcessBatchMovesContext {
  db: Queryable;
  moves: BatchMoveItem[];
  created: BatchCreatedItem[];
  result: BatchOpResult;
  patches: AtomPatchEvent[];
  warnings: string[];
  actor: string | null;
}

export async function processBatchMoves({
  db,
  moves,
  created,
  result,
  patches,
  warnings,
  actor,
}: ProcessBatchMovesContext): Promise<void> {
  const tempIdToNodeId = new Map<string, string>(
    created.map((item) => [item.temp_id, item.node_id])
  );

  for (const item of moves) {
    const oldNode = await selectNodeById(db, item.node_id);
    if (!oldNode) {
      throw new Error(`Node not found: ${item.node_id}`);
    }

    const effectiveParent = resolveMoveParent(item, oldNode.parent_node_id, tempIdToNodeId);
    const { key, warnings: moveWarnings } = await resolvePositionKey(
      db,
      effectiveParent,
      item.node_id,
      {
        before: item.before,
        after: item.after,
        to: item.to,
        position: item.new_position,
      }
    );
    warnings.push(...moveWarnings);

    const movedNode = await moveNode(db, item.node_id, effectiveParent, key);
    if (!movedNode) {
      throw new Error(`Node not found: ${item.node_id}`);
    }

    result.moved.push(item.node_id);
    patches.push({
      type: "node:moved",
      nodeId: item.node_id,
      oldParentNodeId: oldNode.parent_node_id,
      newParentNodeId: effectiveParent,
      node: await toTreeNodeWithCard(db, movedNode),
      affectedNodes: await selectChildrenWithCards(db, effectiveParent),
      actor,
    });
  }
}

function resolveMoveParent(
  item: BatchMoveItem,
  currentParentNodeId: string | null,
  tempIdToNodeId: Map<string, string>
): string | null {
  if (item.parent_temp_id !== undefined) {
    const resolved = tempIdToNodeId.get(item.parent_temp_id);
    if (resolved === undefined) {
      throw new Error(
        `Move: parent_temp_id "${item.parent_temp_id}" not found among batch creates`
      );
    }
    return resolved;
  }

  // Cycle B contract: omitted parent keeps the current parent; null means root.
  return item.new_parent_node_id === undefined
    ? currentParentNodeId
    : item.new_parent_node_id;
}
