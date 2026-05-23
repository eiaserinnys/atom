import { selectNodeById } from "../db/queries/tree.js";
import type { Queryable } from "../db/queryable.js";
import { rekeyEvenly } from "../shared/lexorank.js";
import type {
  AtomPatchEvent,
  BatchChildOrderItem,
  BatchOpResult,
  TreeNode,
} from "../shared/types.js";
import { selectChildrenWithCards, toTreeNodeWithCard } from "./tree-node-payload.js";

interface ProcessBatchChildOrdersContext {
  db: Queryable;
  childOrders: BatchChildOrderItem[];
  result: BatchOpResult;
  patches: AtomPatchEvent[];
  actor: string | null;
}

export async function processBatchChildOrders({
  db,
  childOrders,
  result,
  patches,
  actor,
}: ProcessBatchChildOrdersContext): Promise<void> {
  for (const childOrder of childOrders) {
    await applyChildOrder(db, childOrder, result, patches, actor);
  }
}

async function applyChildOrder(
  db: Queryable,
  childOrder: BatchChildOrderItem,
  result: BatchOpResult,
  patches: AtomPatchEvent[],
  actor: string | null
): Promise<void> {
  const oldNodes = await selectOrderedNodes(db, childOrder);
  const keys = rekeyEvenly(childOrder.order.length);

  for (let i = 0; i < childOrder.order.length; i++) {
    const nodeId = childOrder.order[i];
    await updateOrderedNode(db, childOrder.parent_node_id, keys[i], nodeId);

    const movedNode = await selectNodeById(db, nodeId);
    if (!movedNode) {
      throw new Error(`child_orders: node not found: ${nodeId}`);
    }

    patches.push({
      type: "node:moved",
      nodeId,
      oldParentNodeId: oldNodes.get(nodeId)?.parent_node_id ?? null,
      newParentNodeId: childOrder.parent_node_id,
      node: await toTreeNodeWithCard(db, movedNode),
      affectedNodes: await selectChildrenWithCards(db, childOrder.parent_node_id),
      actor,
    });
  }

  result.child_ordered.push(childOrder.parent_node_id);
}

async function selectOrderedNodes(
  db: Queryable,
  childOrder: BatchChildOrderItem
): Promise<Map<string, TreeNode>> {
  const oldNodes = new Map<string, TreeNode>();
  for (const nodeId of childOrder.order) {
    const oldNode = await selectNodeById(db, nodeId);
    if (!oldNode) {
      throw new Error(`child_orders: node not found: ${nodeId}`);
    }
    oldNodes.set(nodeId, oldNode);
  }
  return oldNodes;
}

async function updateOrderedNode(
  db: Queryable,
  parentNodeId: string | null,
  positionKey: string,
  nodeId: string
): Promise<void> {
  const updateResult = await db.query(
    `UPDATE tree_nodes SET parent_node_id = $1, position = $2
     WHERE id = $3 RETURNING *`,
    [parentNodeId, positionKey, nodeId]
  );
  if (updateResult.rows.length === 0) {
    throw new Error(`child_orders: node not found: ${nodeId}`);
  }
}
