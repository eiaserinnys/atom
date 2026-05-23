import type { MoveNodePayload, TreeNodeData } from '../api/client';

export type TreeDropZone = 'above' | 'below' | 'into';

export interface TreeMovePayload {
  nodeId: string;
  parentNodeId: string | null;
  before?: string;
  after?: string;
  to?: 'start' | 'end';
}

export function buildMovePayload(
  nodeId: string,
  targetNode: TreeNodeData,
  dropZone: TreeDropZone
): TreeMovePayload {
  if (dropZone === 'into') {
    return { nodeId, parentNodeId: targetNode.id, to: 'end' };
  }
  if (dropZone === 'above') {
    return { nodeId, parentNodeId: targetNode.parent_node_id, before: targetNode.id };
  }
  return { nodeId, parentNodeId: targetNode.parent_node_id, after: targetNode.id };
}

export function buildAppendMovePayload(
  nodeId: string,
  parentNodeId: string | null
): TreeMovePayload {
  return { nodeId, parentNodeId, to: 'end' };
}

export function toApiMovePayload(payload: TreeMovePayload): MoveNodePayload {
  const data: MoveNodePayload = {
    parent_node_id: payload.parentNodeId,
  };
  if (payload.before !== undefined) data.before = payload.before;
  if (payload.after !== undefined) data.after = payload.after;
  if (payload.to !== undefined) data.to = payload.to;
  return data;
}
