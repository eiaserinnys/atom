import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { type TreeNodeData } from '../../api/client';
import { fetchFullStructureTree } from '../../api/treeQueries';

interface MoveCardModalProps {
  nodeToMove: TreeNodeData;
  onConfirm: (targetParentNodeId: string) => void;
  onClose: () => void;
  isLoading?: boolean;
}

/** nodeToMove와 그 모든 하위 노드 ID를 재귀적으로 수집 */
function collectDescendantIds(node: TreeNodeData, ids: Set<string>): void {
  ids.add(node.id);
  node.children?.forEach(c => collectDescendantIds(c, ids));
}

interface StructureNodeItemProps {
  node: TreeNodeData;
  excludeIds: Set<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  depth?: number;
}

function StructureNodeItem({ node, excludeIds, selectedId, onSelect, depth = 0 }: StructureNodeItemProps) {
  const isExcluded = excludeIds.has(node.id);
  const isSelected = selectedId === node.id;
  const structureChildren = node.children?.filter(c => c.card.card_type === 'structure') ?? [];

  return (
    <div>
      <button
        disabled={isExcluded}
        onClick={() => !isExcluded && onSelect(node.id)}
        className={`w-full text-left flex items-center gap-1.5 px-2 py-1 rounded text-sm transition-colors ${
          isExcluded
            ? 'opacity-40 cursor-not-allowed text-muted-foreground'
            : isSelected
            ? 'bg-brand/10 text-brand'
            : 'hover:bg-muted text-foreground'
        }`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        <span className="text-xs">📁</span>
        <span className="truncate">{node.card.title}</span>
      </button>
      {structureChildren.length > 0 && (
        <div>
          {structureChildren.map(child => (
            <StructureNodeItem
              key={child.id}
              node={child}
              excludeIds={excludeIds}
              selectedId={selectedId}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function MoveCardModal({ nodeToMove, onConfirm, onClose, isLoading = false }: MoveCardModalProps) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // fetchFullStructureTree: structure 노드만 재귀적으로 전체 트리 로드
  // queryKey를 ['structureTree']로 분리하여 TreeView의 ['tree', null] 캐시를 오염시키지 않음
  const { data: roots, isLoading: treeLoading } = useQuery({
    queryKey: ['structureTree'],
    queryFn: fetchFullStructureTree,
    staleTime: 30_000,
  });

  // nodeToMove와 모든 하위 노드는 이동 대상으로 선택 불가
  const excludeIds = new Set<string>();
  collectDescendantIds(nodeToMove, excludeIds);

  const structureRoots = roots ?? [];

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onKeyDown={handleKeyDown}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-card border border-border rounded-lg shadow-card w-full max-w-sm mx-4 p-6 flex flex-col gap-4 max-h-[70vh]">
        <h2 className="text-base font-semibold text-foreground">{t('move_modal.title')}</h2>

        <p className="text-xs text-muted-foreground">{t('move_modal.select_hint')}</p>

        <div className="flex-1 overflow-y-auto border border-border rounded px-1 py-1 min-h-[120px]">
          {treeLoading && (
            <div className="p-3 text-sm text-muted-foreground">{t('common.loading')}</div>
          )}
          {!treeLoading && structureRoots.length === 0 && (
            <div className="p-3 text-sm text-muted-foreground">{t('move_modal.empty')}</div>
          )}
          {structureRoots.map(root => (
            <StructureNodeItem
              key={root.id}
              node={root}
              excludeIds={excludeIds}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground rounded hover:bg-muted transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={() => selectedId && onConfirm(selectedId)}
            disabled={!selectedId || isLoading}
            className="px-3 py-1.5 text-sm bg-primary hover:opacity-90 text-primary-foreground rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isLoading ? t('common.loading') : t('move_modal.confirm_btn')}
          </button>
        </div>
      </div>
    </div>
  );
}
