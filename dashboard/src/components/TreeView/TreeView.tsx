import { useEffect, useState } from 'react';
import { api, type TreeNodeData } from '../../api/client';
import { TreeNode } from './TreeNode';
import styles from './TreeView.module.css';

interface TreeViewProps {
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
}

export function TreeView({ selectedNodeId, onSelect }: TreeViewProps) {
  const [roots, setRoots] = useState<TreeNodeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api.getTree()
      .then(setRoots)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className={styles.status}>트리 로딩 중...</div>;
  if (error) return <div className={styles.statusError}>오류: {error}</div>;
  if (roots.length === 0) return <div className={styles.status}>노드가 없습니다.</div>;

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
