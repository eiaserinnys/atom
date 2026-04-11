import { describe, test, expect } from 'vitest';
import { applyChildrenPatch, shouldInvalidateCompile } from './treePatching';
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

function makeNode(id: string, cardId: string, parentNodeId: string | null = null, position = 100): TreeNodeData {
  return {
    id,
    card_id: cardId,
    parent_node_id: parentNodeId,
    position,
    is_symlink: false,
    journal_limit: null,
    created_at: '2026-01-01T00:00:00Z',
    card: makeCard(cardId, `Card ${cardId}`),
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
      actor: null,
    };

    const result = applyChildrenPatch(initial, event, parent);

    // naive 기대값: 기존 목록 + 새 노드
    expect(result).toHaveLength(3);
    expect(result[2].id).toBe('n-new');
    expect(result[2].card_id).toBe('c-new');
    expect(result[2].card).toEqual(newCard);
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
    const event: AtomEvent = { type: 'card:deleted', cardId: 'c1', actor: null };

    const result = applyChildrenPatch(initial, event, parent);

    // naive 기대값: c1이 제거됨
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('n2');
    expect(result[0]).toBe(keep); // structural sharing
  });

  test('일치하는 card 없으면 동일 참조 반환', () => {
    const parent = 'parent-1';
    const initial = [makeNode('n1', 'c1', parent)];
    const event: AtomEvent = { type: 'card:deleted', cardId: 'nonexistent', actor: null };

    const result = applyChildrenPatch(initial, event, parent);

    expect(result).toBe(initial);
  });
});

// ─── applyChildrenPatch: node:deleted ───────────────────────────────────────

describe('applyChildrenPatch — node:deleted', () => {
  test('일치하는 nodeId의 노드를 제거한다', () => {
    const parent = 'parent-1';
    const toDelete = makeNode('n1', 'c1', parent);
    const keep = makeNode('n2', 'c2', parent);
    const initial = [toDelete, keep];
    const event: AtomEvent = { type: 'node:deleted', nodeId: 'n1' };

    const result = applyChildrenPatch(initial, event, parent);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('n2');
  });

  test('일치하는 node 없으면 동일 참조 반환', () => {
    const initial = [makeNode('n1', 'c1', null)];
    const event: AtomEvent = { type: 'node:deleted', nodeId: 'nonexistent' };

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
      newParentNodeId: 'other-parent',
    };

    const result = applyChildrenPatch(initial, event, parent);

    // naive 기대값: n1이 이 배열에서 사라짐
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('n2');
  });

  test('일치하는 node 없으면 동일 참조 반환', () => {
    const initial = [makeNode('n1', 'c1', 'parent-1')];
    const event: AtomEvent = { type: 'node:moved', nodeId: 'nonexistent', newParentNodeId: 'other' };

    const result = applyChildrenPatch(initial, event, 'parent-1');

    expect(result).toBe(initial);
  });
});

// ─── structural sharing ───────────────────────────────────────────────────────

describe('structural sharing', () => {
  test('변경 없는 이벤트는 동일 배열 참조를 반환한다', () => {
    const initial = [makeNode('n1', 'c1', null)];
    // 무관한 cardId의 card:deleted
    const event: AtomEvent = { type: 'card:deleted', cardId: 'nonexistent', actor: null };
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
      actor: null,
    };
    expect(shouldInvalidateCompile(event, 'node-xyz')).toBe(true);
  });

  test('selectedNodeId가 있고 node:deleted 이벤트면 true 반환 (기존 버그 수정 검증)', () => {
    // 기존 버그: node:deleted가 compile을 무효화하지 않아 삭제된 노드가 컴파일에 남음
    const event: AtomEvent = { type: 'node:deleted', nodeId: 'n1' };
    expect(shouldInvalidateCompile(event, 'node-xyz')).toBe(true);
  });

  test('selectedNodeId가 있고 node:moved 이벤트면 true 반환', () => {
    const event: AtomEvent = { type: 'node:moved', nodeId: 'n1', newParentNodeId: 'other' };
    expect(shouldInvalidateCompile(event, 'node-xyz')).toBe(true);
  });
});
