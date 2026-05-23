import { QueryClient } from '@tanstack/react-query';
import { describe, expect, test, vi } from 'vitest';
import { applyAtomEventToCache } from './useAtomEvents';
import type { CardData, TreeNodeData } from '../api/client';
import type { AtomEvent } from '../types/events';
import { childrenQueryKey, rootTreeQueryKey } from '../query/queryKeys';

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

describe('applyAtomEventToCache', () => {
  test('batch:completed patches tree and children caches without broad invalidation', () => {
    const queryClient = new QueryClient();
    const root = makeNode('root', 'root-card', null, 100, [
      makeNode('child-1', 'child-card-1', 'root', 100),
    ]);
    const newChild = makeNode('child-2', 'child-card-2', 'root', 200);
    queryClient.setQueryData(rootTreeQueryKey(), [root]);
    queryClient.setQueryData(childrenQueryKey('root'), root.children);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const event: AtomEvent = {
      type: 'batch:completed',
      result: {
        created: [{ temp_id: 't1', card_id: 'child-card-2', node_id: 'child-2' }],
        symlinked: [],
        updated: [],
        node_updated: [],
        moved: [],
        child_ordered: [],
        deleted: [],
      },
      patches: [{
        type: 'card:created',
        cardId: 'child-card-2',
        nodeId: 'child-2',
        parentNodeId: 'root',
        data: newChild.card,
        node: newChild,
        actor: null,
      }],
    };

    applyAtomEventToCache(queryClient, event, null);

    const tree = queryClient.getQueryData<TreeNodeData[]>(rootTreeQueryKey());
    const children = queryClient.getQueryData<TreeNodeData[]>(childrenQueryKey('root'));
    expect(tree?.[0].children?.map((n) => n.id)).toEqual(['child-1', 'child-2']);
    expect(children?.map((n) => n.id)).toEqual(['child-1', 'child-2']);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  test('node:moved patch updates old and new parent caches without parent invalidation', () => {
    const queryClient = new QueryClient();
    const moving = makeNode('moving', 'moving-card', 'old-parent', 100);
    const oldSibling = makeNode('old-sibling', 'old-card', 'old-parent', 200);
    const newSibling = makeNode('new-sibling', 'new-card', 'new-parent', 200);
    queryClient.setQueryData(childrenQueryKey('old-parent'), [moving, oldSibling]);
    queryClient.setQueryData(childrenQueryKey('new-parent'), [newSibling]);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    applyAtomEventToCache(queryClient, {
      type: 'node:moved',
      nodeId: 'moving',
      oldParentNodeId: 'old-parent',
      newParentNodeId: 'new-parent',
      node: { ...moving, parent_node_id: 'new-parent', position: 100 },
      affectedNodes: [{ ...moving, parent_node_id: 'new-parent', position: 100 }, newSibling],
      actor: null,
    }, null);

    expect(queryClient.getQueryData<TreeNodeData[]>(childrenQueryKey('old-parent'))?.map((n) => n.id))
      .toEqual(['old-sibling']);
    expect(queryClient.getQueryData<TreeNodeData[]>(childrenQueryKey('new-parent'))?.map((n) => n.id))
      .toEqual(['moving', 'new-sibling']);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
