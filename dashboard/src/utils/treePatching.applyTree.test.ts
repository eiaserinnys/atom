import { describe, expect, test } from 'vitest';
import { applyChildrenPatch, applyTreePatch } from './treePatching';
import { makeCard, makeNode } from './treePatching.testHelpers';
import type { AtomEvent } from '../types/events';

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
