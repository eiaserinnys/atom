import { updateNodeProperties } from "../db/queries/tree.js";
import type { Queryable } from "../db/queryable.js";
import type {
  AtomPatchEvent,
  BatchNodeUpdateItem,
  BatchOpResult,
  TreeNode,
} from "../shared/types.js";
import { toTreeNodeWithCard } from "./tree-node-payload.js";

interface ProcessBatchNodeUpdatesContext {
  db: Queryable;
  nodeUpdates: BatchNodeUpdateItem[];
  result: BatchOpResult;
  patches: AtomPatchEvent[];
  actor: string | null;
}

export async function processBatchNodeUpdates({
  db,
  nodeUpdates,
  result,
  patches,
  actor,
}: ProcessBatchNodeUpdatesContext): Promise<void> {
  for (const item of nodeUpdates) {
    await applyNodeUpdate(db, item, result, patches, actor);
  }
}

async function applyNodeUpdate(
  db: Queryable,
  item: BatchNodeUpdateItem,
  result: BatchOpResult,
  patches: AtomPatchEvent[],
  actor: string | null
): Promise<void> {
  const { node_id, ...props } = item;
  const { node, updated } = await updateNodeProperties(db, node_id, props);
  if (node === null) {
    throw new Error(`Node not found: ${node_id}`);
  }
  if (!updated) return;

  await recordUpdatedNode(db, node_id, node, result, patches, actor);
}

async function recordUpdatedNode(
  db: Queryable,
  nodeId: string,
  node: TreeNode,
  result: BatchOpResult,
  patches: AtomPatchEvent[],
  actor: string | null
): Promise<void> {
  result.node_updated.push(nodeId);
  patches.push({
    type: "node:updated",
    nodeId,
    node: await toTreeNodeWithCard(db, node),
    actor,
  });
}
