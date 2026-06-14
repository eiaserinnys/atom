import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { AtomEvent, AtomPatchEvent } from '../types/events';
import type { TreeNodeData } from '../api/client';
import { applyChildrenPatch, applyTreePatch, shouldInvalidateCompile } from '../utils/treePatching';
import {
  allChildrenQueryKey,
  allNodeQueryKey,
  childrenQueryKey,
  nodeQueryKey,
  rootTreeQueryKey,
  structureTreeQueryKey,
} from '../query/queryKeys';
import {
  invalidateSelectedCompileQueries,
  invalidateSseReconnectQueries,
} from '../query/invalidation';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const BATCH_DEBOUNCE_MS = 16; // 약 1 렌더 프레임

/**
 * Cached tree arrays에 patch를 적용한다. 변경이 없으면 setQueryData를 호출하지 않는다.
 */
function patchTreeQuery(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  event: AtomPatchEvent
): void {
  const old = queryClient.getQueryData<TreeNodeData[]>(queryKey);
  if (!old) return;
  const patched = applyTreePatch(old, event, null);
  if (patched !== old) {
    queryClient.setQueryData(queryKey, patched);
  }
}

function toStructureTreeEvent(event: AtomPatchEvent): AtomPatchEvent | null {
  switch (event.type) {
    case 'card:created':
    case 'node:created':
      return event.node.card.card_type === 'structure' ? event : null;
    case 'card:updated':
      return event.data.card_type === 'structure' ? event : null;
    case 'node:updated':
      return event.node.card.card_type === 'structure' ? event : null;
    case 'node:moved': {
      const affectedNodes = event.affectedNodes.filter((node) => node.card.card_type === 'structure');
      if (event.node.card.card_type !== 'structure' && affectedNodes.length === 0) return null;
      return { ...event, affectedNodes };
    }
    case 'card:deleted':
    case 'node:deleted':
      return event;
  }
}

function patchTreeCollectionCaches(queryClient: QueryClient, event: AtomPatchEvent): void {
  patchTreeQuery(queryClient, rootTreeQueryKey(), event);

  const structureEvent = toStructureTreeEvent(event);
  if (structureEvent) {
    patchTreeQuery(queryClient, structureTreeQueryKey(), structureEvent);
  }
}

function patchChildrenQuery(
  queryClient: QueryClient,
  parentNodeId: string | null,
  event: AtomPatchEvent
): void {
  if (parentNodeId === null) return;
  const key = childrenQueryKey(parentNodeId);
  const old = queryClient.getQueryData<TreeNodeData[]>(key);
  if (!old) return;
  const patched = applyChildrenPatch(old, event, parentNodeId);
  if (patched !== old) {
    queryClient.setQueryData(key, patched);
  }
}

function patchKnownChildrenQueries(queryClient: QueryClient, event: AtomPatchEvent): void {
  const parentNodeIds = new Set<string | null>();
  switch (event.type) {
    case 'card:created':
    case 'node:created':
      parentNodeIds.add(event.parentNodeId);
      break;
    case 'node:updated':
      parentNodeIds.add(event.node.parent_node_id);
      break;
    case 'node:deleted':
      parentNodeIds.add(event.parentNodeId);
      break;
    case 'node:moved':
      parentNodeIds.add(event.oldParentNodeId);
      parentNodeIds.add(event.newParentNodeId);
      break;
    case 'card:deleted':
      event.parentNodeIds.forEach((parentNodeId) => parentNodeIds.add(parentNodeId));
      break;
    case 'card:updated':
      return;
  }

  for (const parentNodeId of parentNodeIds) {
    patchChildrenQuery(queryClient, parentNodeId, event);
  }
}

function patchAllCachedChildrenQueries(queryClient: QueryClient, event: AtomPatchEvent): void {
  const allChildrenCaches = queryClient.getQueriesData<TreeNodeData[]>({
    queryKey: allChildrenQueryKey(),
  });
  for (const [key, data] of allChildrenCaches) {
    if (!data) continue;
    const parentNodeId = (key as [string, string | null])[1] ?? null;
    const patched = applyChildrenPatch(data, event, parentNodeId);
    if (patched !== data) {
      queryClient.setQueryData(key, patched);
    }
  }
}

function patchChildrenCaches(queryClient: QueryClient, event: AtomPatchEvent): void {
  if (event.type === 'card:updated') {
    patchAllCachedChildrenQueries(queryClient, event);
    return;
  }
  patchKnownChildrenQueries(queryClient, event);
}

function patchNodeCaches(queryClient: QueryClient, event: AtomPatchEvent): void {
  switch (event.type) {
    case 'card:updated': {
      const allNodeCaches = queryClient.getQueriesData<TreeNodeData>({ queryKey: allNodeQueryKey() });
      for (const [key, data] of allNodeCaches) {
        if (data?.card_id === event.cardId) {
          queryClient.setQueryData(key, { ...data, card: event.data });
        }
      }
      break;
    }
    case 'card:deleted': {
      const allNodeCaches = queryClient.getQueriesData<TreeNodeData>({ queryKey: allNodeQueryKey() });
      for (const [key, data] of allNodeCaches) {
        if (data?.card_id === event.cardId) {
          queryClient.removeQueries({ queryKey: key });
        }
      }
      break;
    }
    case 'node:updated':
    case 'node:moved':
      if (queryClient.getQueryData(nodeQueryKey(event.nodeId)) !== undefined) {
        queryClient.setQueryData(nodeQueryKey(event.nodeId), event.node);
      }
      break;
    case 'node:deleted':
      queryClient.removeQueries({ queryKey: nodeQueryKey(event.nodeId) });
      break;
    case 'card:created':
    case 'node:created':
      break;
  }
}

function invalidateCompile(
  queryClient: QueryClient,
  payload: AtomEvent,
  selectedNodeId: string | null
): void {
  if (!shouldInvalidateCompile(payload, selectedNodeId)) return;
  invalidateSelectedCompileQueries(queryClient, selectedNodeId);
}

export function applyAtomEventToCache(
  queryClient: QueryClient,
  payload: AtomEvent,
  selectedNodeId: string | null
): void {
  switch (payload.type) {
    case 'card:created':
      patchTreeCollectionCaches(queryClient, payload);
      patchChildrenCaches(queryClient, payload);
      invalidateCompile(queryClient, payload, selectedNodeId);
      break;

    case 'card:updated':
      patchNodeCaches(queryClient, payload);
      patchTreeCollectionCaches(queryClient, payload);
      patchChildrenCaches(queryClient, payload);
      invalidateCompile(queryClient, payload, selectedNodeId);
      break;

    case 'card:deleted':
      patchTreeCollectionCaches(queryClient, payload);
      patchChildrenCaches(queryClient, payload);
      patchNodeCaches(queryClient, payload);
      invalidateCompile(queryClient, payload, selectedNodeId);
      break;

    case 'node:created':
      patchTreeCollectionCaches(queryClient, payload);
      patchChildrenCaches(queryClient, payload);
      invalidateCompile(queryClient, payload, selectedNodeId);
      break;

    case 'node:updated':
      patchNodeCaches(queryClient, payload);
      patchTreeCollectionCaches(queryClient, payload);
      patchChildrenCaches(queryClient, payload);
      invalidateCompile(queryClient, payload, selectedNodeId);
      break;

    case 'node:deleted':
      patchTreeCollectionCaches(queryClient, payload);
      patchChildrenCaches(queryClient, payload);
      patchNodeCaches(queryClient, payload);
      invalidateCompile(queryClient, payload, selectedNodeId);
      break;

    case 'node:moved':
      patchNodeCaches(queryClient, payload);
      patchTreeCollectionCaches(queryClient, payload);
      patchChildrenCaches(queryClient, payload);
      invalidateCompile(queryClient, payload, selectedNodeId);
      break;

    case 'batch:completed':
      payload.patches.forEach((patch) => {
        applyAtomEventToCache(queryClient, patch, selectedNodeId);
      });
      break;
  }
}

export function useAtomEvents(selectedNodeId: string | null = null) {
  const queryClient = useQueryClient();
  const pendingEvents = useRef<AtomEvent[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // SSE 연결이 한 번이라도 끊어졌으면 재연결 시 전체 재페치로 동기화
  const wasDisconnected = useRef(false);

  useEffect(() => {
    const es = new EventSource(`${BASE_URL}/events`, { withCredentials: true });

    es.onopen = () => {
      if (wasDisconnected.current) {
        // 재연결: 놓친 이벤트가 있을 수 있으므로 전체 재페치로 동기화
        invalidateSseReconnectQueries(queryClient, selectedNodeId);
        wasDisconnected.current = false;
      }
    };

    es.onmessage = (event) => {
      try {
        const payload: AtomEvent = JSON.parse(event.data);
        pendingEvents.current.push(payload);

        // 16ms 디바운스: 연속 이벤트를 단일 렌더 사이클로 배칭
        if (flushTimer.current) clearTimeout(flushTimer.current);
        flushTimer.current = setTimeout(() => {
          const events = pendingEvents.current.splice(0);
          events.forEach((payload) => {
            applyAtomEventToCache(queryClient, payload, selectedNodeId);
          });
        }, BATCH_DEBOUNCE_MS);
      } catch {
        console.warn('[useAtomEvents] 이벤트 파싱 실패:', event.data);
      }
    };

    es.onerror = () => {
      console.warn('[useAtomEvents] SSE 연결 오류. 자동 재연결 시도 중...');
      wasDisconnected.current = true;
    };

    return () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
      es.close();
    };
    // selectedNodeId는 compile invalidation 범위를 결정하므로 의존성에 포함
  }, [queryClient, selectedNodeId]);
}
