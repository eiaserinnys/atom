import { describe, expect, test } from 'vitest';
import { buildAppendMovePayload, buildMovePayload, toApiMovePayload } from './treeMoveIntent';
import type { TreeNodeData } from '../api/client';

function makeNode(
  id: string,
  parentNodeId: string | null,
  position: number,
  cardType: 'structure' | 'knowledge' = 'knowledge'
): TreeNodeData {
  return {
    id,
    card_id: `card-${id}`,
    parent_node_id: parentNodeId,
    position,
    is_symlink: false,
    created_at: '2026-01-01T00:00:00Z',
    journal_limit: null,
    card: {
      id: `card-${id}`,
      card_type: cardType,
      title: id,
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
    },
  };
}

describe('buildMovePayload', () => {
  test('above maps to the server relative before contract without position arithmetic', () => {
    const target = makeNode('target', 'parent-1', 100);

    expect(buildMovePayload('moving', target, 'above')).toEqual({
      nodeId: 'moving',
      parentNodeId: 'parent-1',
      before: 'target',
    });
  });

  test('below maps to the server relative after contract without position arithmetic', () => {
    const target = makeNode('target', null, 0);

    expect(buildMovePayload('moving', target, 'below')).toEqual({
      nodeId: 'moving',
      parentNodeId: null,
      after: 'target',
    });
  });

  test('into appends as the last child of the structure target', () => {
    const target = makeNode('folder', null, 100, 'structure');

    expect(buildMovePayload('moving', target, 'into')).toEqual({
      nodeId: 'moving',
      parentNodeId: 'folder',
      to: 'end',
    });
  });

  test('API payload omits deprecated position and undefined relative keys', () => {
    const payload = buildMovePayload('moving', makeNode('target', 'parent-1', 100), 'above');

    expect(toApiMovePayload(payload)).toStrictEqual({
      parent_node_id: 'parent-1',
      before: 'target',
    });
  });

  test('manual move modal appends to the selected parent through the same relative contract', () => {
    expect(toApiMovePayload(buildAppendMovePayload('moving', null))).toStrictEqual({
      parent_node_id: null,
      to: 'end',
    });
  });
});
