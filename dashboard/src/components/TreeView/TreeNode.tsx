import { useState } from 'react';
import { api, type TreeNodeData } from '../../api/client';

interface TreeNodeProps {
  node: TreeNodeData;
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
  depth?: number;
}

export function TreeNode({ node, selectedNodeId, onSelect, depth = 0 }: TreeNodeProps) {
  // node.children이 있으면 TreeView가 미리 로드한 상태 → childrenLoaded = true
  // node.children이 undefined이면 첫 expand 시 lazy fetch
  const [children, setChildren] = useState<TreeNodeData[]>(node.children ?? []);
  const [childrenLoaded, setChildrenLoaded] = useState(node.children !== undefined);
  const [expanded, setExpanded] = useState(depth === 0); // 루트(depth 0)만 초기 펼침
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // 미로드 상태에서는 화살표 항상 표시 (서버에 child_count 힌트 없음)
  // 로드 후 빈 배열이면 화살표 숨김 (요구사항 7)
  const hasChildren = childrenLoaded ? children.length > 0 : true;
  const isSelected = node.id === selectedNodeId;
  const isStructure = node.card.card_type === 'structure';

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(node.id);
  };

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!expanded && !childrenLoaded) {
      // 첫 expand: lazy fetch
      setLoading(true);
      setFetchError(null);
      try {
        const fetched = await api.listChildren(node.id);
        setChildren(fetched);  // try 블록 내부
        setChildrenLoaded(true);
        // 빈 배열이면 setExpanded 호출하지 않음 → hasChildren = false, 화살표 숨김 (요구사항 7)
        if (fetched.length > 0) {
          setExpanded(true);
        }
      } catch (err) {
        // 오류 시 확장 취소 (setExpanded 호출하지 않음)
        setFetchError(err instanceof Error ? err.message : '오류 발생');
      } finally {
        setLoading(false);
      }
    } else {
      setExpanded((v) => !v);
    }
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
          {loading ? '⏳' : hasChildren ? (expanded ? '▾' : '▸') : ' '}
        </span>
        <span className="text-xs shrink-0" title={isStructure ? 'structure' : 'knowledge'}>
          {isStructure ? '📁' : '📄'}
        </span>
        {node.is_symlink && (
          <span className="text-[10px] text-node-plan shrink-0" title="symlink">↗</span>
        )}
        <span className="text-sm overflow-hidden text-ellipsis whitespace-nowrap flex-1">
          {node.card.title}
        </span>
        {fetchError && (
          <span className="ml-1 text-xs cursor-help shrink-0" title={fetchError}>⚠️</span>
        )}
      </div>
      {hasChildren && expanded && !loading && (
        <div>
          {children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              selectedNodeId={selectedNodeId}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
