import { describe, expect, test } from 'vitest';
import { applyChildrenPatch } from './treePatching';
import { makeCard, makeNode } from './treePatching.testHelpers';
import type { AtomEvent } from '../types/events';

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
