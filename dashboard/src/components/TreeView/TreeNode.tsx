import { useQuery } from '@tanstack/react-query';
import { api, type TreeNodeData } from '../../api/client';

interface TreeNodeProps {
  node: TreeNodeData;
  selectedNodeId: string | null;
  onSelect: (nodeId: string | null) => void;
  depth?: number;
  isExpanded: boolean;
  expandedNodes: Set<string>;
  onToggle: (nodeId: string) => void;
}

export function TreeNode({ node, selectedNodeId, onSelect, depth = 0, isExpanded, expandedNodes, onToggle }: TreeNodeProps) {
  // node.children이 있으면 TreeView가 미리 로드한 상태 → initialData로 사용
  // node.children이 undefined이면 첫 expand 시 lazy fetch
  const propsChildren = node.children; // undefined or TreeNodeData[]
  const { data: children = [], isFetched, isFetching, isError, error } = useQuery<TreeNodeData[]>({
    queryKey: ['children', node.id],
    queryFn: () => api.listChildren(node.id),
    enabled: isExpanded,
    ...(propsChildren !== undefined && {
      initialData: propsChildren,
      initialDataUpdatedAt: Date.now(),
    }),
    staleTime: 30_000,
    gcTime: 0, // collapse 시 캐시 즉시 제거 → 재expand 시 항상 fresh fetch, 접힌 빈 노드도 hasChildren=true 복원
  });

  // 미로드 상태에서는 화살표 항상 표시 (서버에 child_count 힌트 없음)
  // 로드 후 빈 배열이면 화살표 숨김 (요구사항 7)
  const childrenLoaded = isFetched || propsChildren !== undefined;
  const hasChildren = childrenLoaded ? children.length > 0 : true;
  const loading = isFetching;
  const isSelected = node.id === selectedNodeId;
  const isStructure = node.card.card_type === 'structure';

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(node.id);
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle(node.id);
  };

  return (
    <div className="select-none">
      <div
        className={`flex items-center gap-1 py-0.5 pr-2 cursor-pointer rounded mx-1 transition-colors min-h-[26px] ${
          isSelected
            ? 'bg-node-user/15 text-node-user'
            : 'hover:bg-muted'
        }`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={handleClick}
      >
        {/* loading 중에는 재클릭 방지 */}
        <span
          className="w-4 text-center text-[10px] text-muted-foreground cursor-pointer shrink-0"
          onClick={loading ? undefined : (hasChildren ? handleToggle : undefined)}
        >
          {loading ? '⏳' : hasChildren ? (isExpanded ? '▾' : '▸') : ' '}
        </span>
        <span className="text-xs shrink-0" title={isStructure ? 'structure' : 'knowledge'}>
          {isStructure ? '📁' : '📄'}
        </span>
        {node.is_symlink && (
          <span className="text-[10px] text-node-plan shrink-0" title="symlink">↗</span>
        )}
        <span className="flex-1 min-w-0 text-sm truncate">
          {node.card.title}
        </span>
        {node.is_symlink && node.canonical_path && (
          <span
            className="ml-2 shrink-0 text-[10px] text-node-plan bg-node-plan/10 border border-node-plan/20 rounded px-1.5 py-0.5 max-w-[180px] truncate leading-none"
            title={node.canonical_path}
          >
            {node.canonical_path}
          </span>
        )}
        {isError && (
          <span className="ml-1 text-xs cursor-help shrink-0" title={error?.message ?? '오류 발생'}>⚠️</span>
        )}
      </div>
      {hasChildren && isExpanded && !loading && (
        <div>
          {children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              selectedNodeId={selectedNodeId}
              onSelect={onSelect}
              depth={depth + 1}
              isExpanded={expandedNodes.has(child.id)}
              expandedNodes={expandedNodes}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}
