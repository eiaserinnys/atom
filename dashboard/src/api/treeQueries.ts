import { api, type TreeNodeData } from './client';

/**
 * 루트 노드 목록을 가져오고 각 루트의 직계 자식을 함께 로드한다.
 * TreeView와 MoveCardModal이 동일한 query key(['tree', null])로 캐시를 공유한다.
 */
export async function fetchRootsWithChildren(): Promise<TreeNodeData[]> {
  const roots = await api.getTree();
  return Promise.all(
    roots.map(async (root) => {
      try {
        const children = await api.listChildren(root.id);
        return { ...root, children };
      } catch {
        return { ...root, children: [] };
      }
    })
  );
}
