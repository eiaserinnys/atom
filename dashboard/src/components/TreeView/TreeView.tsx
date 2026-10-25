import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  DragOverlay,
} from '@dnd-kit/core';
import { FileText, Folder, LogOut, Plus } from 'lucide-react';
import { api, type TreeNodeData } from '../../api/client';
import { fetchRootsWithChildren } from '../../api/treeQueries';
import { TreeNode } from './TreeNode';
import { TreeDndContext } from './TreeDndContext';
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/ContextMenu';
import { CardFormModal } from '../CardFormModal/CardFormModal';
import { DeleteConfirmModal } from '../DeleteConfirmModal/DeleteConfirmModal';
import { MoveCardModal } from '../MoveCardModal/MoveCardModal';
import { buildAppendMovePayload } from '../../utils/treeMoveIntent';
import { useTreeDragAndDrop } from './useTreeDragAndDrop';
import { useTreeMutations } from './useTreeMutations';
import type { MotionNode } from '../SearchMotionView/types';
import { resolveNodePath } from './useInitialNodePathRestore';
import { useInitialNodePathRestore } from './useInitialNodePathRestore';
import { rootTreeQueryKey } from '../../query/queryKeys';
import {
  buildContextMenuActionDescriptors,
  buildModalConfirmAction,
  type TreeContextMenuAction,
  type TreeModalState,
} from './treeViewActions';

interface TreeViewProps {
  selectedNodeId: string | null;
  onSelect: (nodeId: string | null) => void;
  initialSelectedNodeId?: string;
  searchResults?: MotionNode[];
}

interface ContextMenuState {
  x: number;
  y: number;
  node: TreeNodeData;
}

export function TreeView({ selectedNodeId, onSelect, initialSelectedNodeId, searchResults = [] }: TreeViewProps) {
  const { t } = useTranslation();
  const { data: roots, isLoading, error } = useQuery({
    queryKey: rootTreeQueryKey(),
    queryFn: fetchRootsWithChildren,
    refetchOnWindowFocus: false,
  });

  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [modal, setModal] = useState<TreeModalState>({ type: 'none' });
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const previousRootIds = useRef<Set<string>>(new Set());
  const closeModal = useCallback(() => setModal({ type: 'none' }), []);

  const toggleExpand = useCallback((nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (roots === undefined) return;

    const previousIds = previousRootIds.current;
    const newRootIds = roots
      .filter(root => !previousIds.has(root.id))
      .map(root => root.id);
    previousRootIds.current = new Set(roots.map(root => root.id));

    if (newRootIds.length === 0) return;

    // Preserve legacy auto-expand for roots when they first appear.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpandedNodes(prev => {
      const idsToExpand = newRootIds.filter(id => !prev.has(id));
      if (idsToExpand.length === 0) return prev;

      const next = new Set(prev);
      idsToExpand.forEach(id => next.add(id));
      return next;
    });
  }, [roots]);

  useInitialNodePathRestore({
    initialSelectedNodeId,
    roots,
    getNode: api.getNode,
    setExpandedNodes,
    onSelect,
  });

  useEffect(() => {
    if (!selectedNodeId) return;
    let cancelled = false;
    void resolveNodePath(api.getNode, selectedNodeId).then(path => {
      if (cancelled || !path.length) return;
      setExpandedNodes(previous => new Set([...previous, ...path.slice(0, -1)]));
      requestAnimationFrame(() => document.querySelector(`[data-testid="tree-node-${selectedNodeId}"]`)?.scrollIntoView?.({ block: 'nearest' }));
    });
    return () => { cancelled = true; };
  }, [selectedNodeId]);
  const searchRanks = Object.fromEntries(searchResults.filter(n => n.selected && n.nodeId).map(n => [n.nodeId!, n.rank]));

  const {
    editMutation,
    deleteMutation,
    moveMutation,
    createCard,
    editCard,
    deleteNode,
    moveNode,
    isFormMutating,
  } = useTreeMutations({
    selectedNodeId,
    onSelect,
    setExpandedNodes,
    closeModal,
    setDeleteError,
  });
  const { reset: resetEditMutation } = editMutation;

  const treeDrag = useTreeDragAndDrop({ roots, onMove: moveNode });

  // 컨텍스트 메뉴 핸들러
  const handleContextMenu = useCallback((x: number, y: number, node: TreeNodeData) => {
    setContextMenu({ x, y, node });
  }, []);

  const handleContextMenuAction = useCallback((action: TreeContextMenuAction) => {
    if (action.type === 'create-child') {
      setModal({ type: 'create-child', cardType: action.cardType, parentNode: action.parentNode });
    } else if (action.type === 'move') {
      setModal({ type: 'move', node: action.node });
    } else if (action.type === 'edit') {
      resetEditMutation();
      setModal({ type: 'edit', node: action.node });
    } else if (action.type === 'delete') {
      setModal({ type: 'delete', node: action.node });
    }
  }, [resetEditMutation]);

  const buildContextMenuItems = useCallback((node: TreeNodeData): ContextMenuItem[] =>
    buildContextMenuActionDescriptors(node).map((descriptor) => ({
      label: t(descriptor.labelKey),
      onClick: () => handleContextMenuAction(descriptor.action),
      danger: descriptor.danger,
    })), [handleContextMenuAction, t]);

  // 모달 확인 핸들러
  function handleModalConfirm(title: string, content: string) {
    const action = buildModalConfirmAction(modal, title, content);
    if (action.type === 'create-card') {
      createCard(action.vars);
    } else if (action.type === 'edit-card') {
      editCard(action.vars);
    }
  }

  if (isLoading) return <div className="p-4 text-muted-foreground text-sm">{t('tree.loading')}</div>;
  if (error) return <div className="p-4 text-node-error text-sm">{t('common.error')}: {error.message}</div>;

  return (
    <DndContext
      sensors={treeDrag.sensors}
      onDragStart={treeDrag.handleDragStart}
      onDragMove={treeDrag.handleDragMove}
      onDragOver={treeDrag.handleDragOver}
      onDragEnd={treeDrag.handleDragEnd}
      onDragCancel={treeDrag.handleDragCancel}
    >
      <TreeDndContext.Provider value={treeDrag.dndState}>
        <div className="h-full flex flex-col bg-background border-r border-border">
          {/* 헤더 */}
          <div className="h-10 px-4 flex items-center justify-between border-b border-border bg-card shrink-0">
            <span className="text-[13px] font-semibold uppercase tracking-[0.5px] text-muted-foreground">
              {t('tree.header')}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setModal({ type: 'create-root', cardType: 'structure' })}
                className="flex items-center gap-0.5 px-1.5 py-1 text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted rounded-none transition-colors"
                title={t('tree.create_root_structure')}
              >
                <Plus className="w-3 h-3" />
                <span>{t('tree.add_structure')}</span>
              </button>
              <button
                onClick={() => setModal({ type: 'create-root', cardType: 'knowledge' })}
                className="flex items-center gap-0.5 px-1.5 py-1 text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted rounded-none transition-colors"
                title={t('tree.create_root_knowledge')}
              >
                <Plus className="w-3 h-3" />
                <span>{t('tree.add_knowledge')}</span>
              </button>
            </div>
          </div>

          {/* 트리 본문 */}
          <div className="flex-1 overflow-y-auto py-1">
            {(!roots || roots.length === 0) ? (
              <div className="p-4 text-muted-foreground text-sm">{t('tree.empty')}</div>
            ) : (
              roots.map((root) => (
                <TreeNode
                  key={root.id}
                  node={root}
                  searchRanks={searchRanks}
              selectedNodeId={selectedNodeId}
                  onSelect={onSelect}
                  isExpanded={expandedNodes.has(root.id)}
                  expandedNodes={expandedNodes}
                  onToggle={toggleExpand}
                  onContextMenu={handleContextMenu}
                />
              ))
            )}
          </div>

          {/* 하단 로그아웃 */}
          <div className="shrink-0 border-t border-border px-2 py-2">
            <button
              onClick={() => api.logout().then(() => { window.location.href = '/'; })}
              className="flex items-center gap-2 w-full px-3 py-2 text-[13px] text-muted-foreground rounded-none hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
              title={t('app.logout')}
            >
              <LogOut className="w-3.5 h-3.5" />
              {t('app.logout')}
            </button>
          </div>

          {/* 컨텍스트 메뉴 */}
          {contextMenu && (
            <ContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              items={buildContextMenuItems(contextMenu.node)}
              onClose={() => setContextMenu(null)}
            />
          )}

          {/* 카드 생성/수정 모달 */}
          {(modal.type === 'create-root' || modal.type === 'create-child' || modal.type === 'edit') && (
            <CardFormModal
              mode={modal.type === 'edit' ? 'edit' : 'create'}
              cardType={modal.type !== 'edit' ? modal.cardType : undefined}
              initialTitle={modal.type === 'edit' ? modal.node.card.title : ''}
              initialContent={modal.type === 'edit' ? (modal.node.card.content ?? '') : ''}
              onConfirm={handleModalConfirm}
              onClose={closeModal}
              isLoading={isFormMutating}
              errorMessage={modal.type === 'edit' && editMutation.isError
                ? editMutation.error?.message
                  ? `${t('card.save_failed')}: ${editMutation.error.message}`
                  : t('card.save_failed')
                : undefined}
            />
          )}

          {/* 카드 이동 모달 */}
          {modal.type === 'move' && (
            <MoveCardModal
              nodeToMove={modal.node}
              onConfirm={(targetParentNodeId) => {
                moveNode(
                  buildAppendMovePayload(modal.node.id, targetParentNodeId),
                  { onSuccess: closeModal }
                );
              }}
              onClose={closeModal}
              isLoading={moveMutation.isPending}
            />
          )}

          {/* 삭제 확인 모달 */}
          {modal.type === 'delete' && (
            <DeleteConfirmModal
              title={modal.node.card.title}
              isStructure={modal.node.card.card_type === 'structure'}
              onConfirm={() => deleteNode(modal.node.id)}
              onClose={() => { closeModal(); setDeleteError(null); }}
              isLoading={deleteMutation.isPending}
              errorMessage={deleteError ?? undefined}
            />
          )}
        </div>
      </TreeDndContext.Provider>

      {/* 드래그 오버레이 (드래그 중 유령 표시) */}
      <DragOverlay>
        {treeDrag.activeDragNode ? (
          <div className="flex items-center gap-1 px-3 py-0.5 bg-card border border-border rounded-none shadow-card text-sm text-foreground opacity-90 pointer-events-none">
            {treeDrag.activeDragNode.card.card_type === 'structure'
              ? <Folder className="w-3.5 h-3.5 text-[var(--blue)] shrink-0" strokeWidth={1.75} />
              : <FileText className="w-3.5 h-3.5 text-brand shrink-0" strokeWidth={1.75} />}
            <span className="overflow-hidden text-ellipsis whitespace-nowrap max-w-[200px]">
              {treeDrag.activeDragNode.card.title}
            </span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
