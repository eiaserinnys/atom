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

/**
 * structure 노드만 재귀적으로 전체 트리를 로드한다.
 * MoveCardModal에서 깊은 depth의 structure 노드도 선택 가능하게 하기 위해 사용한다.
 * queryKey: ['structureTree'] — TreeView의 ['tree', null] 캐시와 분리.
 */
async function expandStructureNode(node: TreeNodeData): Promise<TreeNodeData> {
  try {
    const children = await api.listChildren(node.id);
    const structureChildren = children.filter(c => c.card.card_type === 'structure');
    const expanded = await Promise.all(structureChildren.map(expandStructureNode));
    return { ...node, children: expanded };
  } catch {
    return { ...node, children: [] };
  }
}

export async function fetchFullStructureTree(): Promise<TreeNodeData[]> {
  const roots = await api.getTree();
  const structureRoots = roots.filter(r => r.card.card_type === 'structure');
  return Promise.all(structureRoots.map(expandStructureNode));
}
