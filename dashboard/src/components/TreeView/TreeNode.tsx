import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { api, type TreeNodeData } from '../../api/client';
import { useTreeDnd } from './TreeDndContext';

interface TreeNodeProps {
  node: TreeNodeData;
  selectedNodeId: string | null;
  onSelect: (nodeId: string | null) => void;
  depth?: number;
  isExpanded: boolean;
  expandedNodes: Set<string>;
  onToggle: (nodeId: string) => void;
  onContextMenu?: (x: number, y: number, node: TreeNodeData) => void;
}

export function TreeNode({ node, selectedNodeId, onSelect, depth = 0, isExpanded, expandedNodes, onToggle, onContextMenu }: TreeNodeProps) {
  const { t } = useTranslation();
  // node.children이 있으면 TreeView가 미리 로드한 상태 → initialData로 사용
  // node.children이 undefined이면 첫 expand 시 lazy fetch
  const propsChildren = node.children;
  const { data: children = [], isFetched, isFetching, isError, error } = useQuery<TreeNodeData[]>({
    queryKey: ['children', node.id],
    queryFn: () => api.listChildren(node.id),
    enabled: isExpanded,
    ...(propsChildren !== undefined && {
      initialData: propsChildren,
      initialDataUpdatedAt: Date.now(),
    }),
    staleTime: 30_000,
    gcTime: 0,
  });

  const childrenLoaded = isFetched || propsChildren !== undefined;
  const hasChildren = childrenLoaded ? children.length > 0 : true;
  const loading = isFetching;
  const isSelected = node.id === selectedNodeId;
  const isStructure = node.card.card_type === 'structure';

  // DnD 상태 (컨텍스트에서 읽음)
  const { activeId, overId, dropZone } = useTreeDnd();
  const isDragging = activeId === node.id;
  const isDropTarget = overId === node.id && activeId !== node.id;
  const currentDropZone = isDropTarget ? dropZone : null;

  // @dnd-kit draggable
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableRef,
    transform,
  } = useDraggable({
    id: node.id,
    data: { node },
  });

  // @dnd-kit droppable
  // useDraggable과 동일한 id를 쓰면 dnd-kit이 droppable에 ":1" suffix를 자동 부여하므로
  // "droppable-" prefix를 붙여 충돌을 방지한다.
  const { setNodeRef: setDroppableRef } = useDroppable({
    id: `droppable-${node.id}`,
    data: { node },
  });

  // draggable + droppable 동일 엘리먼트에 ref 결합
  const combinedRef = useCallback(
    (el: HTMLDivElement | null) => {
      setDraggableRef(el);
      setDroppableRef(el);
    },
    [setDraggableRef, setDroppableRef]
  );

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(node.id);
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle(node.id);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu?.(e.clientX, e.clientY, node);
  };

  return (
    <div className="select-none" data-testid={`tree-node-${node.id}`}>
      {/* 위쪽 드롭 인디케이터 */}
      {currentDropZone === 'above' && (
        <div className="h-0.5 bg-brand mx-1 rounded-full" />
      )}

      <div
        ref={combinedRef}
        {...attributes}
        {...listeners}
        className={`relative flex items-center gap-1 py-0.5 pr-2 cursor-pointer rounded mx-1 transition-colors min-h-[26px] ${
          isDragging
            ? 'opacity-40'
            : isSelected
            ? 'bg-brand/10 text-brand'
            : isDropTarget && currentDropZone === 'into'
            ? 'bg-brand/15 ring-1 ring-brand/40'
            : 'hover:bg-muted'
        }`}
        style={{
          paddingLeft: `${8 + depth * 16}px`,
          ...(transform ? { transform: CSS.Translate.toString(transform) } : {}),
        }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        {/* 토글 화살표: 클릭만 담당 (DnD listeners는 outer div로 이동) */}
        <span
          className="w-4 text-center text-[10px] text-muted-foreground cursor-grab shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            if (!loading && hasChildren) handleToggle(e);
          }}
        >
          {loading ? '⏳' : hasChildren ? (isExpanded ? '▾' : '▸') : ' '}
        </span>
        <span className="text-xs shrink-0" title={isStructure ? 'structure' : 'knowledge'}>
          {isStructure ? '📁' : '📄'}
        </span>
        {node.is_symlink && (
          <span className="text-[10px] text-muted-foreground shrink-0" title="symlink">↗</span>
        )}
        <span className="flex-1 min-w-0 text-sm truncate">
          {node.card.title}
        </span>
        {node.is_symlink && node.canonical_path && (
          <span
            className="ml-2 shrink-0 text-[10px] text-muted-foreground bg-muted border border-border rounded px-1.5 py-0.5 max-w-[180px] truncate leading-none"
            title={node.canonical_path}
          >
            {node.canonical_path}
          </span>
        )}
        {isError && (
          <span className="ml-1 text-xs cursor-help shrink-0" title={error?.message ?? t('common.error')}>⚠️</span>
        )}
      </div>

      {/* 아래쪽 드롭 인디케이터 */}
      {currentDropZone === 'below' && (
        <div className="h-0.5 bg-brand mx-1 rounded-full" />
      )}

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
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}
