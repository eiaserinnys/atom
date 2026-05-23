import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { AtomEvent, AtomPatchEvent } from '../types/events';
import type { TreeNodeData } from '../api/client';
import { applyChildrenPatch, applyTreePatch, shouldInvalidateCompile } from '../utils/treePatching';
import {
  allChildrenQueryKey,
  allNodeQueryKey,
  nodeQueryKey,
  rootTreeQueryKey,
} from '../query/queryKeys';
import {
  invalidateSelectedCompileQueries,
  invalidateSseReconnectQueries,
} from '../query/invalidation';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const BATCH_DEBOUNCE_MS = 16; // 약 1 렌더 프레임

/**
 * Root tree cache와 모든 children cache에 patch를 적용한다.
 */
function applyToAllTreeCaches(queryClient: QueryClient, event: AtomPatchEvent): void {
  queryClient.setQueryData<TreeNodeData[]>(
    rootTreeQueryKey(),
    (old) => old ? applyTreePatch(old, event, null) : old
  );

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
      applyToAllTreeCaches(queryClient, payload);
      invalidateCompile(queryClient, payload, selectedNodeId);
      break;

    case 'card:updated':
      {
        const allNodeCaches = queryClient.getQueriesData<TreeNodeData>({ queryKey: allNodeQueryKey() });
        for (const [key, data] of allNodeCaches) {
          if (data?.card_id === payload.cardId) {
            queryClient.setQueryData(key, { ...data, card: payload.data });
          }
        }
      }
      applyToAllTreeCaches(queryClient, payload);
      invalidateCompile(queryClient, payload, selectedNodeId);
      break;

    case 'card:deleted':
      applyToAllTreeCaches(queryClient, payload);
      {
        const allNodeCaches = queryClient.getQueriesData<TreeNodeData>({ queryKey: allNodeQueryKey() });
        for (const [key, data] of allNodeCaches) {
          if (data?.card_id === payload.cardId) {
            queryClient.removeQueries({ queryKey: key });
          }
        }
      }
      invalidateCompile(queryClient, payload, selectedNodeId);
      break;

    case 'node:created':
      applyToAllTreeCaches(queryClient, payload);
      invalidateCompile(queryClient, payload, selectedNodeId);
      break;

    case 'node:updated':
      if (queryClient.getQueryData(nodeQueryKey(payload.nodeId)) !== undefined) {
        queryClient.setQueryData(nodeQueryKey(payload.nodeId), payload.node);
      }
      applyToAllTreeCaches(queryClient, payload);
      invalidateCompile(queryClient, payload, selectedNodeId);
      break;

    case 'node:deleted':
      applyToAllTreeCaches(queryClient, payload);
      queryClient.removeQueries({ queryKey: nodeQueryKey(payload.nodeId) });
      invalidateCompile(queryClient, payload, selectedNodeId);
      break;

    case 'node:moved':
      applyToAllTreeCaches(queryClient, payload);
      if (queryClient.getQueryData(nodeQueryKey(payload.nodeId)) !== undefined) {
        queryClient.setQueryData(nodeQueryKey(payload.nodeId), payload.node);
      }
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
