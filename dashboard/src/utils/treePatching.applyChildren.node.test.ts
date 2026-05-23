import { describe, expect, test } from 'vitest';
import { applyChildrenPatch } from './treePatching';
import { makeNode } from './treePatching.testHelpers';
import type { AtomEvent } from '../types/events';

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
