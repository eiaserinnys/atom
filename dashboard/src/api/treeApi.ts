import { request, requestVoid } from './request';
import type { MoveNodePayload, TreeNodeData } from './types';

export const treeApi = {
  getTree(): Promise<TreeNodeData[]> {
    return request('/tree');
  },

  getNode(nodeId: string): Promise<TreeNodeData> {
    return request(`/tree/${nodeId}`);
  },

  updateNode(nodeId: string, data: { journal_limit?: number | null }): Promise<TreeNodeData> {
    return request(`/tree/${nodeId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  deleteNode(nodeId: string): Promise<void> {
    return requestVoid(`/tree/${nodeId}`, { method: 'DELETE' });
  },

  moveNode(nodeId: string, data: MoveNodePayload): Promise<void> {
    return requestVoid(`/tree/${nodeId}/move`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  listChildren(nodeId: string): Promise<TreeNodeData[]> {
    return request(`/tree/${nodeId}/children`);
  },
};
