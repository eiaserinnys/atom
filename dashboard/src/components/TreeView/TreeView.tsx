import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  DragOverlay,
} from '@dnd-kit/core';
import { LogOut, Plus } from 'lucide-react';
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
import { rootTreeQueryKey } from '../../query/queryKeys';

interface TreeViewProps {
  selectedNodeId: string | null;
  onSelect: (nodeId: string | null) => void;
  initialSelectedNodeId?: string;
}

interface ContextMenuState {
  x: number;
  y: number;
  node: TreeNodeData;
}

type ModalState =
  | { type: 'none' }
  | { type: 'create-root'; cardType: 'structure' | 'knowledge' }
  | { type: 'create-child'; cardType: 'structure' | 'knowledge'; parentNode: TreeNodeData }
  | { type: 'edit'; node: TreeNodeData }
  | { type: 'delete'; node: TreeNodeData }
  | { type: 'move'; node: TreeNodeData };

export function TreeView({ selectedNodeId, onSelect, initialSelectedNodeId }: TreeViewProps) {
  const { t } = useTranslation();
  const { data: roots, isLoading, error } = useQuery({
    queryKey: rootTreeQueryKey(),
    queryFn: fetchRootsWithChildren,
  });

  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [modal, setModal] = useState<ModalState>({ type: 'none' });
  const [deleteError, setDeleteError] = useState<string | null>(null);
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
    if (roots?.length) {
      setExpandedNodes(prev => {
        const next = new Set(prev);
        roots.forEach(r => next.add(r.id));
        return next;
      });
    }
  }, [roots]);

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

  const {
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

  const treeDrag = useTreeDragAndDrop({ roots, onMove: moveNode });

  // 컨텍스트 메뉴 핸들러
  const handleContextMenu = useCallback((x: number, y: number, node: TreeNodeData) => {
    setContextMenu({ x, y, node });
  }, []);

  // 컨텍스트 메뉴 항목 구성
  function buildContextMenuItems(node: TreeNodeData): ContextMenuItem[] {
    const isStructure = node.card.card_type === 'structure';
    const items: ContextMenuItem[] = [];

    if (isStructure) {
      items.push({
        label: t('tree.context_create_child_structure'),
        onClick: () => setModal({ type: 'create-child', cardType: 'structure', parentNode: node }),
      });
      items.push({
        label: t('tree.context_create_child_knowledge'),
        onClick: () => setModal({ type: 'create-child', cardType: 'knowledge', parentNode: node }),
      });
    }
    items.push({ label: t('tree.context_move'), onClick: () => setModal({ type: 'move', node }) });
    items.push({ label: t('tree.context_rename'), onClick: () => setModal({ type: 'edit', node }) });
    items.push({ label: t('tree.context_delete'), onClick: () => setModal({ type: 'delete', node }), danger: true });
    return items;
  }

  // 모달 확인 핸들러
  function handleModalConfirm(title: string, content: string) {
    if (modal.type === 'create-root') {
      createCard({ cardType: modal.cardType, title, content, parentNodeId: null });
    } else if (modal.type === 'create-child') {
      createCard({ cardType: modal.cardType, title, content, parentNodeId: modal.parentNode.id });
    } else if (modal.type === 'edit') {
      editCard({ cardId: modal.node.card.id, title, content });
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
            <span className="text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">
              {t('tree.header')}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setModal({ type: 'create-root', cardType: 'structure' })}
                className="flex items-center gap-0.5 px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                title={t('tree.create_root_structure')}
              >
                <Plus className="w-3 h-3" />
                <span>{t('tree.add_structure')}</span>
              </button>
              <button
                onClick={() => setModal({ type: 'create-root', cardType: 'knowledge' })}
                className="flex items-center gap-0.5 px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
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
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-muted-foreground rounded hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
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
          <div className="flex items-center gap-1 px-3 py-0.5 bg-card border border-border rounded shadow-card text-sm text-foreground opacity-90 pointer-events-none">
            <span className="text-xs">
              {treeDrag.activeDragNode.card.card_type === 'structure' ? '📁' : '📄'}
            </span>
            <span className="overflow-hidden text-ellipsis whitespace-nowrap max-w-[200px]">
              {treeDrag.activeDragNode.card.title}
            </span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
