import { useQuery } from '@tanstack/react-query';
import { api, type TreeNodeData } from '../../api/client';
import { TreeNode } from './TreeNode';
import styles from './TreeView.module.css';

interface TreeViewProps {
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
}

async function fetchRootsWithChildren(): Promise<TreeNodeData[]> {
  const roots = await api.getTree();
  const rootsWithChildren = await Promise.all(
    roots.map(async (root) => {
      try {
        const children = await api.listChildren(root.id);
        return { ...root, children };
      } catch {
        return { ...root, children: [] };
      }
    })
  );
  return rootsWithChildren;
}

export function TreeView({ selectedNodeId, onSelect }: TreeViewProps) {
  const { data: roots, isLoading, error } = useQuery({
    queryKey: ['tree', null],
    queryFn: fetchRootsWithChildren,
  });

  if (isLoading) return <div className={styles.status}>트리 로딩 중...</div>;
  if (error) return <div className={styles.statusError}>오류: {error.message}</div>;
  if (!roots || roots.length === 0) return <div className={styles.status}>노드가 없습니다.</div>;

  return (
    <div className={styles.treeContainer}>
      <div className={styles.header}>트리 탐색</div>
      <div className={styles.treeScroll}>
        {roots.map((root) => (
          <TreeNode
            key={root.id}
            node={root}
            selectedNodeId={selectedNodeId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
