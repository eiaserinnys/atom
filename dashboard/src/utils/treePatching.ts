import type { TreeNodeData } from '../api/client';
import type { AtomEvent } from '../types/events';

/**
 * 자식 배열에 SSE 이벤트를 적용하여 새 배열을 반환한다.
 * parentNodeId: 이 배열이 속한 부모 노드 ID (null = root)
 *
 * 변경이 없으면 동일한 참조를 반환한다 (React.memo 최적화를 위한 structural sharing).
 * 변경된 항목만 새 객체로 교체하고, 나머지 항목은 원본 참조를 유지한다.
 */
export function applyChildrenPatch(
  children: TreeNodeData[],
  event: AtomEvent,
  parentNodeId: string | null
): TreeNodeData[] {
  function withExistingChildren(next: TreeNodeData, existing?: TreeNodeData): TreeNodeData {
    if (next.children !== undefined || existing?.children === undefined) return next;
    return { ...next, children: existing.children };
  }

  function upsertNodes(nodes: TreeNodeData[]): TreeNodeData[] {
    const relevantNodes = nodes.filter((node) => node.parent_node_id === parentNodeId);
    if (relevantNodes.length === 0) return children;
    const relevantIds = new Set(relevantNodes.map((node) => node.id));
    const withoutNodes = children.filter((child) => !relevantIds.has(child.id));
    const nextNodes = relevantNodes.map((node) => {
      const existing = children.find((child) => child.id === node.id);
      return withExistingChildren(node, existing);
    });
    return [...withoutNodes, ...nextNodes].sort(
      (a, b) => (a.position - b.position) || a.id.localeCompare(b.id)
    );
  }

  function upsertNode(node: TreeNodeData): TreeNodeData[] {
    return upsertNodes([node]);
  }

  switch (event.type) {
    case 'card:created': {
      // 이 배열의 부모 노드에 추가된 카드인지 확인
      if (event.parentNodeId !== parentNodeId) return children;
      return upsertNode(event.node);
    }

    case 'card:updated': {
      // cardId가 일치하는 노드의 card를 업데이트
      let changed = false;
      const updated = children.map(n => {
        if (n.card_id !== event.cardId) return n;
        changed = true;
        return { ...n, card: event.data };
      });
      return changed ? updated : children;
    }

    case 'card:deleted': {
      const filtered = children.filter(n => n.card_id !== event.cardId);
      return filtered.length !== children.length ? filtered : children;
    }

    case 'node:created': {
      if (event.parentNodeId !== parentNodeId) return children;
      return upsertNode(event.node);
    }

    case 'node:deleted': {
      const filtered = children.filter(n => n.id !== event.nodeId);
      return filtered.length !== children.length ? filtered : children;
    }

    case 'node:moved': {
      if (event.newParentNodeId === parentNodeId) {
        return upsertNodes(event.affectedNodes.length > 0 ? event.affectedNodes : [event.node]);
      }
      if (event.oldParentNodeId !== parentNodeId) return children;
      const filtered = children.filter(n => n.id !== event.nodeId);
      return filtered.length !== children.length ? filtered : children;
    }

    case 'node:updated': {
      let changed = false;
      const updated = children.map(n => {
        if (n.id !== event.nodeId) return n;
        changed = true;
        return withExistingChildren(event.node, n);
      });
      return changed ? updated : children;
    }

    default:
      return children;
  }
}

export function applyTreePatch(
  nodes: TreeNodeData[],
  event: AtomEvent,
  parentNodeId: string | null
): TreeNodeData[] {
  const patchedLevel = applyChildrenPatch(nodes, event, parentNodeId);
  let changed = patchedLevel !== nodes;

  const patchedTree = patchedLevel.map((node) => {
    if (node.children === undefined) return node;
    const patchedChildren = applyTreePatch(node.children, event, node.id);
    if (patchedChildren === node.children) return node;
    changed = true;
    return { ...node, children: patchedChildren };
  });

  return changed ? patchedTree : nodes;
}

/**
 * 이 SSE 이벤트가 현재 컴파일 뷰를 무효화해야 하는지 판단한다.
 * selectedNodeId가 없으면 false (compile view 미열람 상태).
 *
 * 설계 근거: 서버 SSE 이벤트에 subtree 정보(ancestorNodeIds 등)가 없으므로
 * 이벤트가 현재 서브트리에 속하는지 판단할 수 없다.
 * 모든 이벤트가 compile에 영향을 줄 수 있다고 보수적으로 가정하되,
 * 현재 보고 있는 compile 쿼리(selectedNodeId 기준)만 무효화하여
 * 기존의 ALL compile 무효화보다 범위를 제한한다.
 */
export function shouldInvalidateCompile(
  _event: AtomEvent,
  selectedNodeId: string | null
): boolean {
  return selectedNodeId !== null;
}
