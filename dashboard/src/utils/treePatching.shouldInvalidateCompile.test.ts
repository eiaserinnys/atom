import { describe, expect, test } from 'vitest';
import { shouldInvalidateCompile } from './treePatching';
import { makeCard, makeNode } from './treePatching.testHelpers';
import type { AtomEvent } from '../types/events';

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
