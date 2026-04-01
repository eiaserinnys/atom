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
      .then(async (roots) => {
        // 각 루트의 자식을 병렬로 fetch — { ...root, children }로 node.children을 주입하면
        // TreeNode에서 node.children !== undefined → childrenLoaded = true로 초기화됨 (lazy fetch 불필요)
        // 그 자식 노드들의 children은 undefined이므로 childrenLoaded = false → 첫 expand 시 lazy fetch 경로 사용
        const rootsWithChildren = await Promise.all(
          roots.map(async (root) => {
            try {
              const children = await api.listChildren(root.id);
              return { ...root, children };  // then 내부, map 콜백 반환
            } catch {
              return { ...root, children: [] };  // fetch 실패 시 빈 배열로 fallback
            }
          })
        );
        setRoots(rootsWithChildren);
      })
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
