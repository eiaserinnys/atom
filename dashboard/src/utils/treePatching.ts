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
  switch (event.type) {
    case 'card:created': {
      // 이 배열의 부모 노드에 추가된 카드인지 확인
      if (event.parentNodeId !== parentNodeId) return children;
      const newNode: TreeNodeData = {
        id: event.nodeId,
        card_id: event.cardId,
        parent_node_id: event.parentNodeId,
        // 서버가 부여하는 실제 position과 다를 수 있으나,
        // 목록 끝에 추가해두면 후속 재페치(node:created fallback 등)로 보정된다.
        position: children.length > 0
          ? (children[children.length - 1].position ?? 0) + 100
          : 100,
        is_symlink: false,
        created_at: new Date().toISOString(),
        card: event.data,
      };
      return [...children, newNode];
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
      // node:created는 심링크 노드 생성 경로.
      // card data 없이 nodeId/cardId만 있으므로 surgical insert 불가.
      // 호출자(useAtomEvents)에서 invalidateQueries fallback으로 처리한다.
      return children;
    }

    case 'node:deleted': {
      const filtered = children.filter(n => n.id !== event.nodeId);
      return filtered.length !== children.length ? filtered : children;
    }

    case 'node:moved': {
      // 이 배열에서 이동된 노드를 제거한다.
      // 새 부모 위치 삽입은 position 정보 없어 invalidate fallback으로 처리한다.
      const filtered = children.filter(n => n.id !== event.nodeId);
      return filtered.length !== children.length ? filtered : children;
    }

    default:
      return children;
  }
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
