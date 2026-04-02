import { useQuery } from '@tanstack/react-query';
import { api, type TreeNodeData } from '../../api/client';
import { TreeNode } from './TreeNode';

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

  if (isLoading) return <div className="p-4 text-muted-foreground text-sm">트리 로딩 중...</div>;
  if (error) return <div className="p-4 text-node-error text-sm">오류: {error.message}</div>;
  if (!roots || roots.length === 0) return <div className="p-4 text-muted-foreground text-sm">노드가 없습니다.</div>;

  return (
    <div className="h-full flex flex-col bg-background border-r border-border">
      <div className="px-4 py-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground border-b border-border shrink-0">
        트리 탐색
      </div>
      <div className="flex-1 overflow-y-auto py-1">
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
