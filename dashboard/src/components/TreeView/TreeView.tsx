import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type TreeNodeData } from '../../api/client';
import { TreeNode } from './TreeNode';

interface TreeViewProps {
  selectedNodeId: string | null;
  onSelect: (nodeId: string | null) => void;
  initialSelectedNodeId?: string;
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

export function TreeView({ selectedNodeId, onSelect, initialSelectedNodeId }: TreeViewProps) {
  const { data: roots, isLoading, error } = useQuery({
    queryKey: ['tree', null],
    queryFn: fetchRootsWithChildren,
  });

  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  // roots 로드 시 루트 노드 초기 expand
  useEffect(() => {
    if (roots?.length) {
      setExpandedNodes(prev => {
        const next = new Set(prev);
        roots.forEach(r => next.add(r.id));
        return next;
      });
    }
  }, [roots]);

  // initialSelectedNodeId가 있으면 해당 노드까지 경로를 펼치고 선택
  useEffect(() => {
    const targetId = initialSelectedNodeId;
    if (!targetId || !roots?.length) return;

    const restorePath = async () => {
      const path: string[] = [];
      let currentId: string | null = targetId;
      while (currentId) {
        try {
          const node = await api.getNode(currentId);
          path.unshift(currentId);
          currentId = node.parent_node_id ?? null;
        } catch {
          break;
        }
      }
      if (path.length === 0) return;
      // 리프 노드를 제외한 조상 노드들을 expand (기존 루트 expand와 병합)
      setExpandedNodes(prev => {
        const next = new Set(prev);
        path.slice(0, -1).forEach(id => next.add(id));
        return next;
      });
      onSelect(targetId);
    };

    restorePath();
  // roots가 로드된 직후 1회만 실행
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots]);

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
            isExpanded={expandedNodes.has(root.id)}
            expandedNodes={expandedNodes}
            onToggle={toggleExpand}
          />
        ))}
      </div>
    </div>
  );
}
