import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LogOut, Plus } from 'lucide-react';
import { api, type TreeNodeData } from '../../api/client';
import { TreeNode } from './TreeNode';
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

export function TreeView({ selectedNodeId, onSelect, initialSelectedNodeId }: TreeViewProps) {
  const queryClient = useQueryClient();
  const { data: roots, isLoading, error } = useQuery({
    queryKey: ['tree', null],
    queryFn: fetchRootsWithChildren,
  });

  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [modal, setModal] = useState<ModalState>({ type: 'none' });

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
      // 부모 노드를 expand (새 자식이 보이도록)
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
    items.push({
      label: '수정',
      onClick: () => setModal({ type: 'edit', node }),
    });
    items.push({
      label: '삭제',
      onClick: () => setModal({ type: 'delete', node }),
      danger: true,
    });
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

  if (isLoading) return <div className="p-4 text-muted-foreground text-sm">트리 로딩 중...</div>;
  if (error) return <div className="p-4 text-node-error text-sm">오류: {error.message}</div>;

  return (
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
  );
}
