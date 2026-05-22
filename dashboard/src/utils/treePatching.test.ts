import { describe, test, expect } from 'vitest';
import { applyChildrenPatch, applyTreePatch, shouldInvalidateCompile } from './treePatching';
import type { TreeNodeData, CardData } from '../api/client';
import type { AtomEvent } from '../types/events';

// ─── 헬퍼 ───────────────────────────────────────────────────────────────────

function makeCard(id: string, title: string): CardData {
  return {
    id,
    card_type: 'knowledge',
    title,
    content: null,
    references: [],
    tags: [],
    card_timestamp: '2026-01-01T00:00:00Z',
    content_timestamp: null,
    source_type: null,
    source_ref: null,
    staleness: 'unverified',
    version: 1,
    updated_at: '2026-01-01T00:00:00Z',
    created_by: null,
    updated_by: null,
  };
}

function makeNode(
  id: string,
  cardId: string,
  parentNodeId: string | null = null,
  position = 100,
  children?: TreeNodeData[]
): TreeNodeData {
  return {
    id,
    card_id: cardId,
    parent_node_id: parentNodeId,
    position,
    is_symlink: false,
    journal_limit: null,
    created_at: '2026-01-01T00:00:00Z',
    card: makeCard(cardId, `Card ${cardId}`),
    ...(children !== undefined ? { children } : {}),
  };
}

// ─── applyChildrenPatch: card:created ───────────────────────────────────────

describe('applyChildrenPatch — card:created', () => {
  test('해당 부모의 자식 목록에 새 노드를 추가한다', () => {
    const parent = 'parent-1';
    const initial = [makeNode('n1', 'c1', parent), makeNode('n2', 'c2', parent)];
    const newCard = makeCard('c-new', 'New Card');
    const event: AtomEvent = {
      type: 'card:created',
      cardId: 'c-new',
      nodeId: 'n-new',
      parentNodeId: parent,
      data: newCard,
      node: {
        ...makeNode('n-new', 'c-new', parent, 150),
        card: newCard,
      },
      actor: null,
    };

    const result = applyChildrenPatch(initial, event, parent);

    // naive 기대값: 기존 목록 + 새 노드
    expect(result).toHaveLength(3);
    expect(result[2].id).toBe('n-new');
    expect(result[2].card_id).toBe('c-new');
    expect(result[2].card).toEqual(newCard);
    expect(result[2].position).toBe(150);
    // 기존 항목은 동일 참조 보존 (structural sharing)
    expect(result[0]).toBe(initial[0]);
    expect(result[1]).toBe(initial[1]);
  });

  test('다른 부모의 이벤트는 무시한다 — 동일 참조 반환', () => {
    const parent = 'parent-1';
    const initial = [makeNode('n1', 'c1', parent)];
    const event: AtomEvent = {
      type: 'card:created',
      cardId: 'c-new',
      nodeId: 'n-new',
      parentNodeId: 'other-parent',
      data: makeCard('c-new', 'New Card'),
      node: makeNode('n-new', 'c-new', 'other-parent'),
      actor: null,
    };

    const result = applyChildrenPatch(initial, event, parent);

    expect(result).toBe(initial); // 동일 참조 반환
  });

  test('빈 배열에 새 노드를 추가한다', () => {
    const parent = 'parent-1';
    const newCard = makeCard('c-new', 'New Card');
    const event: AtomEvent = {
      type: 'card:created',
      cardId: 'c-new',
      nodeId: 'n-new',
      parentNodeId: parent,
      data: newCard,
      node: {
        ...makeNode('n-new', 'c-new', parent, 100),
        card: newCard,
      },
      actor: null,
    };

    const result = applyChildrenPatch([], event, parent);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('n-new');
  });
});

// ─── applyChildrenPatch: card:updated ───────────────────────────────────────

describe('applyChildrenPatch — card:updated', () => {
  test('일치하는 card_id의 card 데이터를 교체한다', () => {
    const parent = 'parent-1';
    const original = makeNode('n1', 'c1', parent);
    const initial = [original, makeNode('n2', 'c2', parent)];
    const updatedCard = makeCard('c1', 'Updated Title');
    const event: AtomEvent = { type: 'card:updated', cardId: 'c1', data: updatedCard, actor: null };

    const result = applyChildrenPatch(initial, event, parent);

    // naive 기대값: c1의 card만 교체됨
    expect(result[0].card.title).toBe('Updated Title');
    expect(result[0].card).toBe(updatedCard);
    // 다른 노드는 동일 참조 (structural sharing)
    expect(result[1]).toBe(initial[1]);
    // 수정된 노드는 새 객체 (불변성)
    expect(result[0]).not.toBe(original);
  });

  test('일치하는 card 없으면 동일 참조 반환', () => {
    const parent = 'parent-1';
    const initial = [makeNode('n1', 'c1', parent)];
    const event: AtomEvent = {
      type: 'card:updated',
      cardId: 'other-card',
      data: makeCard('other-card', 'X'),
      actor: null,
    };

    const result = applyChildrenPatch(initial, event, parent);

    expect(result).toBe(initial);
  });
});

// ─── applyChildrenPatch: card:deleted ───────────────────────────────────────

describe('applyChildrenPatch — card:deleted', () => {
  test('일치하는 card_id의 노드를 제거한다', () => {
    const parent = 'parent-1';
    const toDelete = makeNode('n1', 'c1', parent);
    const keep = makeNode('n2', 'c2', parent);
    const initial = [toDelete, keep];
    const event: AtomEvent = {
      type: 'card:deleted',
      cardId: 'c1',
      nodeIds: ['n1'],
      parentNodeIds: [parent],
      actor: null,
    };

    const result = applyChildrenPatch(initial, event, parent);

    // naive 기대값: c1이 제거됨
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('n2');
    expect(result[0]).toBe(keep); // structural sharing
  });

  test('일치하는 card 없으면 동일 참조 반환', () => {
    const parent = 'parent-1';
    const initial = [makeNode('n1', 'c1', parent)];
    const event: AtomEvent = {
      type: 'card:deleted',
      cardId: 'nonexistent',
      nodeIds: [],
      parentNodeIds: [],
      actor: null,
    };

    const result = applyChildrenPatch(initial, event, parent);

    expect(result).toBe(initial);
  });
});

// ─── applyChildrenPatch: node:deleted ───────────────────────────────────────

describe('applyChildrenPatch — node:created', () => {
  test('node payload가 있으면 해당 부모의 자식 목록에 삽입한다', () => {
    const parent = 'parent-1';
    const initial = [makeNode('n1', 'c1', parent, 100), makeNode('n3', 'c3', parent, 300)];
    const symlink = { ...makeNode('n2', 'c2', parent, 200), is_symlink: true };
    const event: AtomEvent = {
      type: 'node:created',
      nodeId: 'n2',
      cardId: 'c2',
      parentNodeId: parent,
      node: symlink,
      actor: null,
    };

    const result = applyChildrenPatch(initial, event, parent);

    expect(result.map((n) => n.id)).toEqual(['n1', 'n2', 'n3']);
    expect(result[1]).toEqual(symlink);
  });

  test('이미 있는 node:created 이벤트는 중복 삽입하지 않고 최신 node로 교체한다', () => {
    const parent = 'parent-1';
    const stale = makeNode('n1', 'c1', parent, 100);
    const fresh = { ...stale, journal_limit: 3 };
    const event: AtomEvent = {
      type: 'node:created',
      nodeId: 'n1',
      cardId: 'c1',
      parentNodeId: parent,
      node: fresh,
      actor: null,
    };

    const result = applyChildrenPatch([stale], event, parent);

    expect(result).toHaveLength(1);
    expect(result[0].journal_limit).toBe(3);
  });
});

describe('applyChildrenPatch — node:deleted', () => {
  test('일치하는 nodeId의 노드를 제거한다', () => {
    const parent = 'parent-1';
    const toDelete = makeNode('n1', 'c1', parent);
    const keep = makeNode('n2', 'c2', parent);
    const initial = [toDelete, keep];
    const event: AtomEvent = {
      type: 'node:deleted',
      nodeId: 'n1',
      cardId: 'c1',
      parentNodeId: parent,
      actor: null,
    };

    const result = applyChildrenPatch(initial, event, parent);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('n2');
  });

  test('일치하는 node 없으면 동일 참조 반환', () => {
    const initial = [makeNode('n1', 'c1', null)];
    const event: AtomEvent = {
      type: 'node:deleted',
      nodeId: 'nonexistent',
      cardId: 'nonexistent-card',
      parentNodeId: null,
      actor: null,
    };

    const result = applyChildrenPatch(initial, event, null);

    expect(result).toBe(initial);
  });
});

// ─── applyChildrenPatch: node:moved ─────────────────────────────────────────

describe('applyChildrenPatch — node:moved', () => {
  test('이동된 노드를 기존 부모 배열에서 제거한다', () => {
    const parent = 'parent-1';
    const toMove = makeNode('n1', 'c1', parent);
    const stay = makeNode('n2', 'c2', parent);
    const initial = [toMove, stay];
    const event: AtomEvent = {
      type: 'node:moved',
      nodeId: 'n1',
      oldParentNodeId: parent,
      newParentNodeId: 'other-parent',
      node: { ...toMove, parent_node_id: 'other-parent', position: 200 },
      affectedNodes: [{ ...toMove, parent_node_id: 'other-parent', position: 200 }],
      actor: null,
    };

    const result = applyChildrenPatch(initial, event, parent);

    // naive 기대값: n1이 이 배열에서 사라짐
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('n2');
  });

  test('일치하는 node 없으면 동일 참조 반환', () => {
    const initial = [makeNode('n1', 'c1', 'parent-1')];
    const event: AtomEvent = {
      type: 'node:moved',
      nodeId: 'nonexistent',
      oldParentNodeId: 'parent-1',
      newParentNodeId: 'other',
      node: makeNode('nonexistent', 'other-card', 'other'),
      affectedNodes: [makeNode('nonexistent', 'other-card', 'other')],
      actor: null,
    };

    const result = applyChildrenPatch(initial, event, 'parent-1');

    expect(result).toBe(initial);
  });

  test('새 부모 배열에는 이동된 노드를 position 순서로 삽입한다', () => {
    const parent = 'new-parent';
    const initial = [makeNode('n1', 'c1', parent, 100), makeNode('n3', 'c3', parent, 300)];
    const moved = makeNode('n2', 'c2', parent, 200);
    const event: AtomEvent = {
      type: 'node:moved',
      nodeId: 'n2',
      oldParentNodeId: 'old-parent',
      newParentNodeId: parent,
      node: moved,
      affectedNodes: [moved],
      actor: null,
    };

    const result = applyChildrenPatch(initial, event, parent);

    expect(result.map((n) => n.id)).toEqual(['n1', 'n2', 'n3']);
  });

  test('affectedNodes가 있으면 새 부모의 sibling position도 함께 갱신한다', () => {
    const parent = 'new-parent';
    const staleA = makeNode('n1', 'c1', parent, 100);
    const staleB = makeNode('n3', 'c3', parent, 101);
    const moved = makeNode('n2', 'c2', parent, 500);
    const event: AtomEvent = {
      type: 'node:moved',
      nodeId: 'n2',
      oldParentNodeId: 'old-parent',
      newParentNodeId: parent,
      node: moved,
      affectedNodes: [
        { ...staleA, position: 333 },
        moved,
        { ...staleB, position: 666 },
      ],
      actor: null,
    };

    const result = applyChildrenPatch([staleA, staleB], event, parent);

    expect(result.map((n) => n.id)).toEqual(['n1', 'n2', 'n3']);
    expect(result.map((n) => n.position)).toEqual([333, 500, 666]);
  });
});

// ─── applyChildrenPatch: node:updated ───────────────────────────────────────

describe('applyChildrenPatch — node:updated', () => {
  test('일치하는 node를 최신 node payload로 교체한다', () => {
    const parent = 'parent-1';
    const original = makeNode('n1', 'c1', parent);
    const updated = { ...original, journal_limit: 7 };
    const event: AtomEvent = {
      type: 'node:updated',
      nodeId: 'n1',
      node: updated,
      actor: null,
    };

    const result = applyChildrenPatch([original], event, parent);

    expect(result[0].journal_limit).toBe(7);
    expect(result[0]).not.toBe(original);
  });
});

// ─── applyTreePatch: nested root children ───────────────────────────────────

describe('applyTreePatch', () => {
  test("['tree', null] 내부 root.children에도 card:created를 적용한다", () => {
    const root = makeNode('root', 'root-card', null, 100, [
      makeNode('child-1', 'child-card-1', 'root', 100),
    ]);
    const newChild = makeNode('child-2', 'child-card-2', 'root', 200);
    const event: AtomEvent = {
      type: 'card:created',
      cardId: 'child-card-2',
      nodeId: 'child-2',
      parentNodeId: 'root',
      data: newChild.card,
      node: newChild,
      actor: null,
    };

    const result = applyTreePatch([root], event, null);

    expect(result[0].children?.map((n) => n.id)).toEqual(['child-1', 'child-2']);
    expect(result[0]).not.toBe(root);
  });

  test('중첩된 root.children의 card:updated도 stale 상태로 남기지 않는다', () => {
    const child = makeNode('child-1', 'child-card-1', 'root', 100);
    const root = makeNode('root', 'root-card', null, 100, [child]);
    const updatedCard = makeCard('child-card-1', 'Updated Child');
    const event: AtomEvent = {
      type: 'card:updated',
      cardId: 'child-card-1',
      data: updatedCard,
      actor: null,
    };

    const result = applyTreePatch([root], event, null);

    expect(result[0].children?.[0].card.title).toBe('Updated Child');
    expect(result[0].children?.[0]).not.toBe(child);
  });
});

// ─── structural sharing ───────────────────────────────────────────────────────

describe('structural sharing', () => {
  test('변경 없는 이벤트는 동일 배열 참조를 반환한다', () => {
    const initial = [makeNode('n1', 'c1', null)];
    // 무관한 cardId의 card:deleted
    const event: AtomEvent = {
      type: 'card:deleted',
      cardId: 'nonexistent',
      nodeIds: [],
      parentNodeIds: [],
      actor: null,
    };
    const result = applyChildrenPatch(initial, event, null);
    expect(result).toBe(initial);
  });

  test('card:updated 시 변경된 노드만 새 객체, 나머지는 동일 참조', () => {
    const parent = 'parent-1';
    const n1 = makeNode('n1', 'c1', parent);
    const n2 = makeNode('n2', 'c2', parent);
    const n3 = makeNode('n3', 'c3', parent);
    const initial = [n1, n2, n3];
    const event: AtomEvent = {
      type: 'card:updated',
      cardId: 'c2',
      data: makeCard('c2', 'Updated'),
      actor: null,
    };

    const result = applyChildrenPatch(initial, event, parent);

    expect(result[0]).toBe(n1); // 동일 참조
    expect(result[1]).not.toBe(n2); // 새 객체
    expect(result[2]).toBe(n3); // 동일 참조
  });
});

// ─── shouldInvalidateCompile ──────────────────────────────────────────────────

describe('shouldInvalidateCompile', () => {
  test('selectedNodeId가 없으면 false 반환 (compile view 미열람)', () => {
    const event: AtomEvent = {
      type: 'card:updated',
      cardId: 'c1',
      data: makeCard('c1', 'X'),
      actor: null,
    };
    expect(shouldInvalidateCompile(event, null)).toBe(false);
  });

  test('selectedNodeId가 있고 card:updated 이벤트면 true 반환', () => {
    const event: AtomEvent = {
      type: 'card:updated',
      cardId: 'c1',
      data: makeCard('c1', 'X'),
      actor: null,
    };
    expect(shouldInvalidateCompile(event, 'node-xyz')).toBe(true);
  });

  test('selectedNodeId가 있고 card:created 이벤트면 true 반환 (기존 버그 수정 검증)', () => {
    // 기존 버그: card:created가 compile을 무효화하지 않아 컴파일 문서가 구조 변경을 감지 못함
    const event: AtomEvent = {
      type: 'card:created',
      cardId: 'c-new',
      nodeId: 'n-new',
      parentNodeId: 'parent-1',
      data: makeCard('c-new', 'New Card'),
      node: makeNode('n-new', 'c-new', 'parent-1'),
      actor: null,
    };
    expect(shouldInvalidateCompile(event, 'node-xyz')).toBe(true);
  });

  test('selectedNodeId가 있고 node:deleted 이벤트면 true 반환 (기존 버그 수정 검증)', () => {
    // 기존 버그: node:deleted가 compile을 무효화하지 않아 삭제된 노드가 컴파일에 남음
    const event: AtomEvent = {
      type: 'node:deleted',
      nodeId: 'n1',
      cardId: 'c1',
      parentNodeId: null,
      actor: null,
    };
    expect(shouldInvalidateCompile(event, 'node-xyz')).toBe(true);
  });

  test('selectedNodeId가 있고 node:moved 이벤트면 true 반환', () => {
    const event: AtomEvent = {
      type: 'node:moved',
      nodeId: 'n1',
      oldParentNodeId: null,
      newParentNodeId: 'other',
      node: makeNode('n1', 'c1', 'other'),
      affectedNodes: [makeNode('n1', 'c1', 'other')],
      actor: null,
    };
    expect(shouldInvalidateCompile(event, 'node-xyz')).toBe(true);
  });
});
