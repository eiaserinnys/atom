// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { applyAtomEventToCache, useAtomEvents } from './useAtomEvents';
import type { CardData, TreeNodeData } from '../api/client';
import type { AtomEvent } from '../types/events';
import {
  allChildrenQueryKey, allNodeQueryKey, childrenQueryKey, rootTreeQueryKey,
  standardCompileNodeQueryKey, structureTreeQueryKey, unfurlCompileNodeQueryKey,
} from '../query/queryKeys';

function makeCard(id: string, title: string, cardType: CardData['card_type'] = 'knowledge'): CardData {
  return {
    id,
    card_type: cardType,
    title,
    content: null,
    references: [],
    tags: [],
    card_timestamp: '2026-01-01T00:00:00Z',
    content_timestamp: null,
    source_type: null,
    source_ref: null,
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
  children?: TreeNodeData[],
  cardType: CardData['card_type'] = 'knowledge'
): TreeNodeData {
  return {
    id,
    card_id: cardId,
    parent_node_id: parentNodeId,
    position,
    is_symlink: false,
    journal_limit: null,
    created_at: '2026-01-01T00:00:00Z',
    card: makeCard(cardId, `Card ${cardId}`, cardType),
    ...(children !== undefined ? { children } : {}),
  };
}

// EventSource and time are boundaries; React and the cache patch path remain real.
class TestEventSource {
  static instances: TestEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor() {
    TestEventSource.instances.push(this);
  }

  receive(event: AtomEvent) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

function EventSubscriber({ selectedNodeId }: { selectedNodeId: string | null }) {
  useAtomEvents(selectedNodeId);
  return null;
}

describe('useAtomEvents lifecycle', () => {
  let root: Root | null;
  let container: HTMLDivElement;
  let queryClient: QueryClient;

  function render(selectedNodeId: string | null, client = queryClient) {
    act(() => {
      root!.render(createElement(StrictMode, null,
        createElement(QueryClientProvider, { client },
          createElement(EventSubscriber, { selectedNodeId }))));
    });
  }

  function connection() {
    return TestEventSource.instances.at(-1)!;
  }

  function createEvent(): AtomEvent {
    const node = makeNode('new-root', 'new-card', null, 200, [], 'structure');
    return {
      type: 'card:created', cardId: node.card_id, nodeId: node.id,
      parentNodeId: null, data: node.card, node, actor: null,
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('EventSource', TestEventSource);
    TestEventSource.instances = [];
    queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    queryClient.setQueryData(rootTreeQueryKey(), []);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
    queryClient.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test('selection before the flush preserves the connection and adds the root once', () => {
    render('old-selection');
    const es = connection();
    const connectionCount = TestEventSource.instances.length;
    const write = vi.spyOn(queryClient, 'setQueryData');
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    es.receive(createEvent());
    act(() => vi.advanceTimersByTime(8));
    render('new-root');

    // Keep going to the cache assertion so the original lost-event defect is explicit.
    act(() => vi.advanceTimersByTime(8));
    expect(queryClient.getQueryData<TreeNodeData[]>(rootTreeQueryKey())?.map((n) => n.id))
      .toEqual(['new-root']);
    expect(TestEventSource.instances).toHaveLength(connectionCount);
    expect(es.close).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      standardCompileNodeQueryKey('new-root'), unfurlCompileNodeQueryKey('new-root'),
    ]);
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(16));
    expect(write).toHaveBeenCalledTimes(1);
  });

  test('error then open recovers tree caches and the committed current selection', () => {
    render('old-selection');
    const es = connection();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    es.onopen?.();
    expect(invalidate).not.toHaveBeenCalled();

    es.onerror?.();
    render('current-selection');
    connection().onopen?.();
    expect(connection()).toBe(es);
    expect(warning).toHaveBeenCalledTimes(1);
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      rootTreeQueryKey(), allChildrenQueryKey(), allNodeQueryKey(),
      standardCompileNodeQueryKey('current-selection'),
      unfurlCompileNodeQueryKey('current-selection'),
    ]);
    es.onopen?.();
    expect(invalidate).toHaveBeenCalledTimes(5);
  });

  test('client replacement and unmount close connections and discard queued work', () => {
    render('old-selection');
    // StrictMode's initial cleanup also closes its abandoned connection.
    expect(TestEventSource.instances[0].close).toHaveBeenCalledTimes(1);
    const oldConnection = connection();
    const oldWrite = vi.spyOn(queryClient, 'setQueryData');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    oldConnection.receive(createEvent());
    oldConnection.onerror?.();
    const nextClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    nextClient.setQueryData(rootTreeQueryKey(), []);
    const nextWrite = vi.spyOn(nextClient, 'setQueryData');
    const invalidate = vi.spyOn(nextClient, 'invalidateQueries');

    render('new-root', nextClient);
    expect(oldConnection.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    connection().onopen?.();
    expect(invalidate).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(16));
    expect(oldWrite).not.toHaveBeenCalled();
    expect(nextWrite).not.toHaveBeenCalled();

    // A fresh event must not pick up the previous connection's abandoned queue.
    connection().receive(createEvent());
    act(() => vi.advanceTimersByTime(16));
    expect(nextWrite).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    nextWrite.mockClear();
    connection().receive(createEvent());
    act(() => root!.unmount());
    root = null;
    expect(connection().close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(16));
    expect(nextWrite).not.toHaveBeenCalled();
    nextClient.clear();
  });
});

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
    const unrelatedChildren = [makeNode('unrelated-child', 'unrelated-card', 'unrelated-parent', 100)];
    queryClient.setQueryData(childrenQueryKey('old-parent'), [moving, oldSibling]);
    queryClient.setQueryData(childrenQueryKey('new-parent'), [newSibling]);
    queryClient.setQueryData(childrenQueryKey('unrelated-parent'), unrelatedChildren);
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
    expect(queryClient.getQueryData<TreeNodeData[]>(childrenQueryKey('unrelated-parent')))
      .toBe(unrelatedChildren);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  test('card:updated patches structure tree cache for structure nodes', () => {
    const queryClient = new QueryClient();
    const structureChild = makeNode('structure-child', 'structure-card', 'root', 100, [], 'structure');
    const structureRoot = makeNode('root', 'root-card', null, 100, [structureChild], 'structure');
    const updatedCard = makeCard('structure-card', 'Renamed structure', 'structure');
    queryClient.setQueryData(structureTreeQueryKey(), [structureRoot]);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    applyAtomEventToCache(queryClient, {
      type: 'card:updated',
      cardId: 'structure-card',
      data: updatedCard,
      actor: null,
    }, null);

    const structureTree = queryClient.getQueryData<TreeNodeData[]>(structureTreeQueryKey());
    expect(structureTree?.[0].children?.[0].card.title).toBe('Renamed structure');
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  test('knowledge creates do not enter structure tree cache', () => {
    const queryClient = new QueryClient();
    const structureRoot = makeNode('root', 'root-card', null, 100, [], 'structure');
    const structureTree = [structureRoot];
    queryClient.setQueryData(structureTreeQueryKey(), structureTree);
    const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    applyAtomEventToCache(queryClient, {
      type: 'card:created',
      cardId: 'knowledge-card',
      nodeId: 'knowledge-node',
      parentNodeId: 'root',
      data: makeCard('knowledge-card', 'Knowledge'),
      node: makeNode('knowledge-node', 'knowledge-card', 'root', 100),
      actor: null,
    }, null);

    expect(queryClient.getQueryData<TreeNodeData[]>(structureTreeQueryKey())).toBe(structureTree);
    expect(queryClient.getQueryData<TreeNodeData[]>(structureTreeQueryKey())?.[0].children).toEqual([]);
    expect(setQueryDataSpy).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  test('irrelevant parent create leaves cached tree data untouched', () => {
    const queryClient = new QueryClient();
    const rootTree = [makeNode('root', 'root-card', null, 100, [], 'structure')];
    const unrelatedChildren = [makeNode('unrelated-child', 'unrelated-card', 'unrelated-parent', 100)];
    queryClient.setQueryData(rootTreeQueryKey(), rootTree);
    queryClient.setQueryData(childrenQueryKey('unrelated-parent'), unrelatedChildren);
    const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    applyAtomEventToCache(queryClient, {
      type: 'card:created',
      cardId: 'new-card',
      nodeId: 'new-node',
      parentNodeId: 'missing-parent',
      data: makeCard('new-card', 'New card'),
      node: makeNode('new-node', 'new-card', 'missing-parent', 100),
      actor: null,
    }, null);

    expect(queryClient.getQueryData<TreeNodeData[]>(rootTreeQueryKey())).toBe(rootTree);
    expect(queryClient.getQueryData<TreeNodeData[]>(childrenQueryKey('unrelated-parent')))
      .toBe(unrelatedChildren);
    expect(setQueryDataSpy).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
