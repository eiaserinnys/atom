import { describe, expect, test } from 'vitest';
import type { TreeNodeData } from '../../api/client';
import {
  buildContextMenuActionDescriptors,
  buildModalConfirmAction,
  type TreeModalState,
} from './treeViewActions';

function treeNode(id: string, cardType: 'structure' | 'knowledge' = 'structure'): TreeNodeData {
  return {
    id,
    card_id: `card-${id}`,
    parent_node_id: null,
    position: 0,
    is_symlink: false,
    created_at: '2026-05-24T00:00:00.000Z',
    journal_limit: null,
    card: {
      id: `card-${id}`,
      card_type: cardType,
      title: `${id} title`,
      content: `${id} content`,
      references: [],
      tags: [],
      card_timestamp: '2026-05-24T00:00:00.000Z',
      content_timestamp: null,
      source_type: null,
      source_ref: null,
      staleness: 'unverified',
      version: 1,
      updated_at: '2026-05-24T00:00:00.000Z',
      created_by: null,
      updated_by: null,
    },
  };
}

describe('tree view context menu action descriptors', () => {
  test('builds structure node actions in the existing order', () => {
    const node = treeNode('structure-node', 'structure');

    expect(buildContextMenuActionDescriptors(node)).toStrictEqual([
      {
        labelKey: 'tree.context_create_child_structure',
        action: { type: 'create-child', cardType: 'structure', parentNode: node },
      },
      {
        labelKey: 'tree.context_create_child_knowledge',
        action: { type: 'create-child', cardType: 'knowledge', parentNode: node },
      },
      { labelKey: 'tree.context_move', action: { type: 'move', node } },
      { labelKey: 'tree.context_rename', action: { type: 'edit', node } },
      { labelKey: 'tree.context_delete', action: { type: 'delete', node }, danger: true },
    ]);
  });

  test('builds knowledge node actions without child creation entries', () => {
    const node = treeNode('knowledge-node', 'knowledge');

    expect(buildContextMenuActionDescriptors(node)).toStrictEqual([
      { labelKey: 'tree.context_move', action: { type: 'move', node } },
      { labelKey: 'tree.context_rename', action: { type: 'edit', node } },
      { labelKey: 'tree.context_delete', action: { type: 'delete', node }, danger: true },
    ]);
  });
});

describe('tree view modal confirm actions', () => {
  test('builds a root create card mutation action', () => {
    const modal: TreeModalState = { type: 'create-root', cardType: 'structure' };

    expect(buildModalConfirmAction(modal, 'Root', 'Body')).toStrictEqual({
      type: 'create-card',
      vars: { cardType: 'structure', title: 'Root', content: 'Body', parentNodeId: null },
    });
  });

  test('builds a child create card mutation action', () => {
    const parentNode = treeNode('parent', 'structure');
    const modal: TreeModalState = { type: 'create-child', cardType: 'knowledge', parentNode };

    expect(buildModalConfirmAction(modal, 'Child', 'Text')).toStrictEqual({
      type: 'create-card',
      vars: { cardType: 'knowledge', title: 'Child', content: 'Text', parentNodeId: 'parent' },
    });
  });

  test('builds an edit card mutation action', () => {
    const node = treeNode('edited', 'knowledge');
    const modal: TreeModalState = { type: 'edit', node };

    expect(buildModalConfirmAction(modal, 'Renamed', '')).toStrictEqual({
      type: 'edit-card',
      vars: { cardId: 'card-edited', title: 'Renamed', content: '' },
    });
  });

  test('keeps non-form modal confirmations as no-ops', () => {
    const node = treeNode('action-node', 'structure');
    const modals: TreeModalState[] = [
      { type: 'none' },
      { type: 'delete', node },
      { type: 'move', node },
    ];

    expect(modals.map(modal => buildModalConfirmAction(modal, 'Ignored', 'Ignored'))).toStrictEqual([
      { type: 'noop' },
      { type: 'noop' },
      { type: 'noop' },
    ]);
  });
});
