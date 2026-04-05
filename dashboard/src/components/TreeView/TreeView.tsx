import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { LogOut, Plus } from 'lucide-react';
import { api, type TreeNodeData } from '../../api/client';
import { TreeNode } from './TreeNode';
import { TreeDndContext, type DropZone } from './TreeDndContext';
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/ContextMenu';
import { CardFormModal } from '../CardFormModal/CardFormModal';
import { DeleteConfirmModal } from '../DeleteConfirmModal/DeleteConfirmModal';

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
  | { type: 'delete'; node: TreeNodeData };

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

/** 드래그 위치 → DropZone 계산 */
function calcDropZone(
  activeTranslatedTop: number,
  activeHeight: number,
  overRectTop: number,
  overRectHeight: number,
  isStructure: boolean
): DropZone {
  const cursorY = activeTranslatedTop + activeHeight / 2;
  const relativeY = cursorY - overRectTop;
  const ratio = relativeY / overRectHeight;

  if (ratio < 0.3) return 'above';
  if (ratio > 0.7) return 'below';
  return isStructure ? 'into' : (ratio < 0.5 ? 'above' : 'below');
}

export function TreeView({ selectedNodeId, onSelect, initialSelectedNodeId }: TreeViewProps) {
  const queryClient = useQueryClient();
  const { data: roots, isLoading, error } = useQuery({
    queryKey: ['tree', null],
    queryFn: fetchRootsWithChildren,
  });

  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [modal, setModal] = useState<ModalState>({ type: 'none' });

  // DnD 상태
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [dropZone, setDropZone] = useState<DropZone | null>(null);

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
    setActiveId(event.active.id as string);
  }

  function handleDragOver(event: DragOverEvent) {
    const { over, active } = event;
    if (!over) { setOverId(null); setDropZone(null); return; }

    const overNode = (over.data.current as { node: TreeNodeData }).node;
    const translatedRect = active.rect.current.translated;
    const overRect = over.rect;

    if (!translatedRect || !overRect) {
      setOverId(over.id as string);
      setDropZone('into');
      return;
    }

    const zone = calcDropZone(
      translatedRect.top,
      translatedRect.height,
      overRect.top,
      overRect.height,
      overNode.card.card_type === 'structure'
    );
    setOverId(over.id as string);
    setDropZone(zone);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (over && active.id !== over.id && dropZone && roots) {
      const draggedNode = findNodeInTree(active.id as string, roots);
      const targetNode = (over.data.current as { node: TreeNodeData }).node;

      // 순환 참조 방지: 드래그 노드가 타겟의 조상이면 이동 불가
      const circular = isAncestorOf(active.id as string, over.id as string, roots);

      if (draggedNode && !circular) {
        let parentNodeId: string | null;
        let position: number | undefined;

        if (dropZone === 'into') {
          parentNodeId = targetNode.id;
          position = undefined; // 마지막 자식으로 append
        } else if (dropZone === 'above') {
          parentNodeId = targetNode.parent_node_id;
          position = targetNode.position;
        } else { // below
          parentNodeId = targetNode.parent_node_id;
          position = targetNode.position + 1;
        }

        moveMutation.mutate({ nodeId: active.id as string, parentNodeId, position });
      }
    }

    setActiveId(null);
    setOverId(null);
    setDropZone(null);
  }

  function handleDragCancel() {
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
        label: '하위 구조 카드 생성',
        onClick: () => setModal({ type: 'create-child', cardType: 'structure', parentNode: node }),
      });
      items.push({
        label: '하위 지식 카드 생성',
        onClick: () => setModal({ type: 'create-child', cardType: 'knowledge', parentNode: node }),
      });
    }
    items.push({ label: '수정', onClick: () => setModal({ type: 'edit', node }) });
    items.push({ label: '삭제', onClick: () => setModal({ type: 'delete', node }), danger: true });
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

  // 드래그 오버레이용 활성 노드
  const activeNode = activeId && roots ? findNodeInTree(activeId, roots) : null;

  if (isLoading) return <div className="p-4 text-muted-foreground text-sm">트리 로딩 중...</div>;
  if (error) return <div className="p-4 text-node-error text-sm">오류: {error.message}</div>;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <TreeDndContext.Provider value={{ activeId, overId, dropZone }}>
        <div className="h-full flex flex-col bg-background border-r border-border">
          {/* 헤더 */}
          <div className="px-4 py-3 flex items-center justify-between border-b border-border shrink-0">
            <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              트리 탐색
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setModal({ type: 'create-root', cardType: 'structure' })}
                className="flex items-center gap-0.5 px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                title="루트 구조 카드 생성"
              >
                <Plus className="w-3 h-3" />
                <span>구조</span>
              </button>
              <button
                onClick={() => setModal({ type: 'create-root', cardType: 'knowledge' })}
                className="flex items-center gap-0.5 px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                title="루트 지식 카드 생성"
              >
                <Plus className="w-3 h-3" />
                <span>지식</span>
              </button>
            </div>
          </div>

          {/* 트리 본문 */}
          <div className="flex-1 overflow-y-auto py-1">
            {(!roots || roots.length === 0) ? (
              <div className="p-4 text-muted-foreground text-sm">노드가 없습니다.</div>
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
              title="로그아웃"
            >
              <LogOut className="w-3.5 h-3.5" />
              로그아웃
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

          {/* 삭제 확인 모달 */}
          {modal.type === 'delete' && (
            <DeleteConfirmModal
              title={modal.node.card.title}
              isStructure={modal.node.card.card_type === 'structure'}
              onConfirm={() => deleteMutation.mutate(modal.node.id)}
              onClose={() => setModal({ type: 'none' })}
              isLoading={deleteMutation.isPending}
            />
          )}
        </div>
      </TreeDndContext.Provider>

      {/* 드래그 오버레이 (드래그 중 유령 표시) */}
      <DragOverlay>
        {activeNode ? (
          <div className="flex items-center gap-1 px-3 py-0.5 bg-neutral-800 border border-neutral-600 rounded shadow-lg text-sm text-white opacity-90 pointer-events-none">
            <span className="text-xs">
              {activeNode.card.card_type === 'structure' ? '📁' : '📄'}
            </span>
            <span className="overflow-hidden text-ellipsis whitespace-nowrap max-w-[200px]">
              {activeNode.card.title}
            </span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
