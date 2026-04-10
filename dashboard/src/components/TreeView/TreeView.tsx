import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { LogOut, Plus } from 'lucide-react';
import { api, type TreeNodeData } from '../../api/client';
import { fetchRootsWithChildren } from '../../api/treeQueries';
import { TreeNode } from './TreeNode';
import { TreeDndContext, type DropZone } from './TreeDndContext';
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/ContextMenu';
import { CardFormModal } from '../CardFormModal/CardFormModal';
import { DeleteConfirmModal } from '../DeleteConfirmModal/DeleteConfirmModal';
import { MoveCardModal } from '../MoveCardModal/MoveCardModal';

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

/** 로드된 트리에서 특정 노드를 찾음 */
function findNodeInTree(nodeId: string, nodes: TreeNodeData[]): TreeNodeData | null {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    if (node.children) {
      const found = findNodeInTree(nodeId, node.children);
      if (found) return found;
    }
  }
  return null;
}

/** draggedId가 targetId의 조상인지 확인 (순환 이동 방지) */
function isAncestorOf(ancestorId: string, targetId: string, nodes: TreeNodeData[]): boolean {
  function hasDescendant(node: TreeNodeData, id: string): boolean {
    if (!node.children) return false;
    return node.children.some(c => c.id === id || hasDescendant(c, id));
  }
  const ancestor = findNodeInTree(ancestorId, nodes);
  if (!ancestor) return false;
  return hasDescendant(ancestor, targetId);
}

/** 드래그 위치 → DropZone 계산 (실제 포인터 Y 좌표 기반) */
function calcDropZone(
  pointerY: number,
  overRectTop: number,
  overRectHeight: number,
  isStructure: boolean
): DropZone {
  const relativeY = pointerY - overRectTop;
  const ratio = relativeY / overRectHeight;

  if (ratio < 0.3) return 'above';
  if (ratio > 0.7) return 'below';
  return isStructure ? 'into' : (ratio < 0.5 ? 'above' : 'below');
}

export function TreeView({ selectedNodeId, onSelect, initialSelectedNodeId }: TreeViewProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: roots, isLoading, error } = useQuery({
    queryKey: ['tree', null],
    queryFn: fetchRootsWithChildren,
  });

  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [modal, setModal] = useState<ModalState>({ type: 'none' });
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // DnD 상태
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeDragNode, setActiveDragNode] = useState<TreeNodeData | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [dropZone, setDropZone] = useState<DropZone | null>(null);

  // useRef로 실시간 값 추적 — handleDragOver/handleDragEnd는 이벤트 핸들러로 렌더 클로저 바깥에서 호출되어
  // React state는 항상 직전 렌더 시점의 값을 캡처하므로 stale read가 발생한다.
  // ref는 항상 최신 값을 가리키므로 DnD 정확도를 보장한다.
  const pointerYRef = useRef<number | null>(null);
  const dropZoneRef = useRef<DropZone | null>(null);

  // 드래그 중에만 커서 Y 좌표를 추적한다 (activeId가 없으면 리스너 등록 안 함)
  useEffect(() => {
    if (!activeId) return;
    const onPointerMove = (e: PointerEvent) => { pointerYRef.current = e.clientY; };
    window.addEventListener('pointermove', onPointerMove);
    return () => window.removeEventListener('pointermove', onPointerMove);
  }, [activeId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

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

  // 캐시 무효화 헬퍼
  function invalidateTree() {
    queryClient.invalidateQueries({ queryKey: ['tree'] });
    queryClient.invalidateQueries({ queryKey: ['children'] });
  }

  // 카드 생성 뮤테이션
  const createMutation = useMutation({
    mutationFn: (vars: { cardType: 'structure' | 'knowledge'; title: string; content: string; parentNodeId?: string | null }) =>
      api.createCard({
        card_type: vars.cardType,
        title: vars.title,
        content: vars.content || undefined,
        parent_node_id: vars.parentNodeId ?? null,
      }),
    onSuccess: (result, vars) => {
      invalidateTree();
      if (vars.parentNodeId) {
        setExpandedNodes(prev => { const n = new Set(prev); n.add(vars.parentNodeId!); return n; });
      }
      onSelect(result.node_id);
      setModal({ type: 'none' });
    },
  });

  // 카드 수정 뮤테이션
  const editMutation = useMutation({
    mutationFn: (vars: { cardId: string; title: string; content: string }) =>
      api.updateCard(vars.cardId, { title: vars.title, content: vars.content || undefined }),
    onSuccess: () => {
      invalidateTree();
      setModal({ type: 'none' });
    },
  });

  // 노드 삭제 뮤테이션
  const deleteMutation = useMutation({
    mutationFn: (nodeId: string) => api.deleteNode(nodeId),
    onSuccess: (_data, nodeId) => {
      if (selectedNodeId === nodeId) onSelect(null);
      invalidateTree();
      setModal({ type: 'none' });
      setDeleteError(null);
    },
    onError: (err) => {
      setDeleteError(err instanceof Error ? err.message : '삭제 중 오류가 발생했습니다.');
    },
  });

  // 노드 이동 뮤테이션
  const moveMutation = useMutation({
    mutationFn: (vars: { nodeId: string; parentNodeId: string | null; position?: number }) =>
      api.moveNode(vars.nodeId, { parent_node_id: vars.parentNodeId, position: vars.position }),
    onSuccess: () => invalidateTree(),
  });

  // DnD 이벤트 핸들러
  function handleDragStart(event: DragStartEvent) {
    const activeData = event.active.data.current as { node?: TreeNodeData } | undefined;
    setActiveDragNode(activeData?.node ?? null);
    setActiveId(event.active.id as string);
  }

  /**
   * 드롭 존 계산 공통 로직.
   * onDragOver: over 엘리먼트가 바뀔 때 1회 발생 → 엘리먼트 진입 시점에만 계산됨.
   * onDragMove: 포인터가 움직일 때마다 발생 → 같은 엘리먼트 안에서도 매번 재계산.
   * 두 이벤트 모두 이 함수를 통해 처리해야 same-element 내 위치 변화를 정확히 반영한다.
   */
  function applyDropZone(over: DragOverEvent['over'] | DragMoveEvent['over']): void {
    if (!over) { setOverId(null); setDropZone(null); dropZoneRef.current = null; return; }

    const overData = over.data.current as { node?: TreeNodeData } | undefined;
    if (!overData?.node) { setOverId(null); setDropZone(null); dropZoneRef.current = null; return; }
    const overNode = overData.node;
    const overRect = over.rect;

    const currentPointerY = pointerYRef.current;
    if (currentPointerY === null || !overRect) {
      const fallbackZone: DropZone = overNode.card.card_type === 'structure' ? 'into' : 'above';
      setOverId(overNode.id);
      setDropZone(fallbackZone);
      dropZoneRef.current = fallbackZone;
      return;
    }

    const zone = calcDropZone(
      currentPointerY,
      overRect.top,
      overRect.height,
      overNode.card.card_type === 'structure'
    );
    setOverId(overNode.id);
    setDropZone(zone);
    dropZoneRef.current = zone;
  }

  function handleDragMove(event: DragMoveEvent) { applyDropZone(event.over); }
  function handleDragOver(event: DragOverEvent) { applyDropZone(event.over); }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    // dropZoneRef.current: handleDragOver에서 동기적으로 갱신된 최신 값.
    // dropZone state는 렌더 클로저에 캡처된 이전 값일 수 있으므로 ref를 사용한다.
    const currentDropZone = dropZoneRef.current;
    if (over && currentDropZone && roots) {
      const overData = over.data.current as { node?: TreeNodeData } | undefined;
      const targetNode = overData?.node;

      if (targetNode && activeDragNode && active.id !== targetNode.id) {
        // 순환 참조 방지: 드래그 노드가 타겟의 조상이면 이동 불가
        // over.data.current.node.id를 사용해야 ":1" suffix 없는 실제 UUID를 얻음
        const circular = isAncestorOf(active.id as string, targetNode.id, roots);

        if (!circular) {
          let parentNodeId: string | null;
          let position: number | undefined;

          if (currentDropZone === 'into') {
            parentNodeId = targetNode.id;
            position = undefined; // 마지막 자식으로 append
          } else if (currentDropZone === 'above') {
            parentNodeId = targetNode.parent_node_id;
            // target.position 자리에 직접 넣으면 target과 충돌한다.
            // 서버는 100 간격으로 position을 관리하므로 position - 1은 항상 비어있다.
            position = targetNode.position - 1;
          } else { // below
            parentNodeId = targetNode.parent_node_id;
            position = targetNode.position + 1;
          }

          moveMutation.mutate({ nodeId: active.id as string, parentNodeId, position });
        }
      }
    }

    pointerYRef.current = null;
    dropZoneRef.current = null;
    setActiveDragNode(null);
    setActiveId(null);
    setOverId(null);
    setDropZone(null);
  }

  function handleDragCancel() {
    pointerYRef.current = null;
    dropZoneRef.current = null;
    setActiveDragNode(null);
    setActiveId(null);
    setOverId(null);
    setDropZone(null);
  }

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
      createMutation.mutate({ cardType: modal.cardType, title, content, parentNodeId: null });
    } else if (modal.type === 'create-child') {
      createMutation.mutate({ cardType: modal.cardType, title, content, parentNodeId: modal.parentNode.id });
    } else if (modal.type === 'edit') {
      editMutation.mutate({ cardId: modal.node.card.id, title, content });
    }
  }

  const isMutating = createMutation.isPending || editMutation.isPending || deleteMutation.isPending;

  // 드래그 오버레이용 활성 노드 — handleDragStart에서 저장한 state를 사용
  // (roots는 depth 0/1만 포함하므로 findNodeInTree로는 depth 2+ 노드를 찾을 수 없음)

  if (isLoading) return <div className="p-4 text-muted-foreground text-sm">{t('tree.loading')}</div>;
  if (error) return <div className="p-4 text-node-error text-sm">{t('common.error')}: {error.message}</div>;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <TreeDndContext.Provider value={{ activeId, overId, dropZone }}>
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
              onClose={() => setModal({ type: 'none' })}
              isLoading={isMutating}
            />
          )}

          {/* 카드 이동 모달 */}
          {modal.type === 'move' && (
            <MoveCardModal
              nodeToMove={modal.node}
              onConfirm={(targetParentNodeId) => {
                moveMutation.mutate(
                  { nodeId: modal.node.id, parentNodeId: targetParentNodeId, position: undefined },
                  { onSuccess: () => setModal({ type: 'none' }) }
                );
              }}
              onClose={() => setModal({ type: 'none' })}
              isLoading={moveMutation.isPending}
            />
          )}

          {/* 삭제 확인 모달 */}
          {modal.type === 'delete' && (
            <DeleteConfirmModal
              title={modal.node.card.title}
              isStructure={modal.node.card.card_type === 'structure'}
              onConfirm={() => deleteMutation.mutate(modal.node.id)}
              onClose={() => { setModal({ type: 'none' }); setDeleteError(null); }}
              isLoading={deleteMutation.isPending}
              errorMessage={deleteError ?? undefined}
            />
          )}
        </div>
      </TreeDndContext.Provider>

      {/* 드래그 오버레이 (드래그 중 유령 표시) */}
      <DragOverlay>
        {activeDragNode ? (
          <div className="flex items-center gap-1 px-3 py-0.5 bg-card border border-border rounded shadow-card text-sm text-foreground opacity-90 pointer-events-none">
            <span className="text-xs">
              {activeDragNode.card.card_type === 'structure' ? '📁' : '📄'}
            </span>
            <span className="overflow-hidden text-ellipsis whitespace-nowrap max-w-[200px]">
              {activeDragNode.card.title}
            </span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
