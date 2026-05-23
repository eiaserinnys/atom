import { describe, expect, test } from 'vitest';
import { calcDropZone, isAncestorOf } from './treeDndLogic';
import type { TreeNodeData } from '../../api/client';

function makeNode(
  id: string,
  parentNodeId: string | null,
  children?: TreeNodeData[]
): TreeNodeData {
  return {
    id,
    card_id: `card-${id}`,
    parent_node_id: parentNodeId,
    position: 100,
    is_symlink: false,
    created_at: '2026-01-01T00:00:00Z',
    journal_limit: null,
    card: {
      id: `card-${id}`,
      card_type: 'knowledge',
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
    ...(children !== undefined ? { children } : {}),
  };
}

describe('calcDropZone', () => {
  test('maps the top and bottom bands independently of node type', () => {
    expect(calcDropZone(20, 0, 100, true)).toBe('above');
    expect(calcDropZone(80, 0, 100, true)).toBe('below');
    expect(calcDropZone(20, 0, 100, false)).toBe('above');
    expect(calcDropZone(80, 0, 100, false)).toBe('below');
  });

  test('maps the middle band to into only for structure nodes', () => {
    expect(calcDropZone(50, 0, 100, true)).toBe('into');
    expect(calcDropZone(40, 0, 100, false)).toBe('above');
    expect(calcDropZone(60, 0, 100, false)).toBe('below');
  });

  test('uses the hovered rect top when calculating pointer ratio', () => {
    expect(calcDropZone(125, 100, 100, true)).toBe('above');
    expect(calcDropZone(175, 100, 100, true)).toBe('below');
  });
});

describe('isAncestorOf', () => {
  test('detects nested descendants for circular move prevention', () => {
    const roots = [
      makeNode('root', null, [
        makeNode('folder', 'root', [
          makeNode('leaf', 'folder'),
        ]),
      ]),
    ];

    expect(isAncestorOf('root', 'leaf', roots)).toBe(true);
    expect(isAncestorOf('folder', 'leaf', roots)).toBe(true);
    expect(isAncestorOf('leaf', 'folder', roots)).toBe(false);
    expect(isAncestorOf('missing', 'leaf', roots)).toBe(false);
  });
});
