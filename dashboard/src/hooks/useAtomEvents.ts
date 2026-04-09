import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AtomEvent } from '../types/events';
import type { TreeNodeData } from '../api/client';
import { applyChildrenPatch, shouldInvalidateCompile } from '../utils/treePatching';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const BATCH_DEBOUNCE_MS = 16; // 약 1 렌더 프레임

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
        queryClient.invalidateQueries({ queryKey: ['tree', null] });
        queryClient.invalidateQueries({ queryKey: ['children'] });
        queryClient.invalidateQueries({ queryKey: ['node'] });
        if (selectedNodeId) {
          queryClient.invalidateQueries({ queryKey: ['compile', selectedNodeId] });
          queryClient.invalidateQueries({ queryKey: ['compile-unfurl', selectedNodeId] });
        }
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
          events.forEach(handleEvent);
        }, BATCH_DEBOUNCE_MS);
      } catch {
        console.warn('[useAtomEvents] 이벤트 파싱 실패:', event.data);
      }
    };

    es.onerror = () => {
      console.warn('[useAtomEvents] SSE 연결 오류. 자동 재연결 시도 중...');
      wasDisconnected.current = true;
    };

    /**
     * ['tree', null]과 모든 ['children', *] 캐시에 patch를 적용한다.
     */
    function applyToAllChildrenCaches(event: AtomEvent): void {
      // root 배열 패치
      queryClient.setQueryData<TreeNodeData[]>(
        ['tree', null],
        (old) => old ? applyChildrenPatch(old, event, null) : old
      );

      // 모든 ['children', parentNodeId] 캐시 패치
      const allChildrenCaches = queryClient.getQueriesData<TreeNodeData[]>({
        queryKey: ['children'],
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

    /**
     * 현재 보고 있는 compile 쿼리를 무효화한다.
     * React Query prefix 매칭 의도적 활용:
     * CompileView는 ['compile', nodeId, depth] 키를 사용하므로
     * ['compile', selectedNodeId] prefix로 depth 무관하게 모두 무효화됨.
     */
    function invalidateCompile(payload: AtomEvent): void {
      if (!shouldInvalidateCompile(payload, selectedNodeId)) return;
      queryClient.invalidateQueries({ queryKey: ['compile', selectedNodeId] });
      queryClient.invalidateQueries({ queryKey: ['compile-unfurl', selectedNodeId] });
    }

    function handleEvent(payload: AtomEvent) {
      switch (payload.type) {
        case 'card:created':
          applyToAllChildrenCaches(payload);
          invalidateCompile(payload);
          break;

        case 'card:updated':
          // ['node', *] 캐시에서 card_id 일치 노드 surgical update
          {
            const allNodeCaches = queryClient.getQueriesData<TreeNodeData>({ queryKey: ['node'] });
            for (const [key, data] of allNodeCaches) {
              if (data?.card_id === payload.cardId) {
                queryClient.setQueryData(key, { ...data, card: payload.data });
              }
            }
          }
          applyToAllChildrenCaches(payload);
          invalidateCompile(payload);
          break;

        case 'card:deleted':
          applyToAllChildrenCaches(payload);
          // 삭제된 카드의 node 쿼리 제거
          {
            const allNodeCaches = queryClient.getQueriesData<TreeNodeData>({ queryKey: ['node'] });
            for (const [key, data] of allNodeCaches) {
              if (data?.card_id === payload.cardId) {
                queryClient.removeQueries({ queryKey: key });
              }
            }
          }
          invalidateCompile(payload);
          break;

        case 'node:created':
          // 심링크 노드 생성: card data 없어 surgical insert 불가 → invalidate fallback
          if (payload.parentNodeId) {
            queryClient.invalidateQueries({ queryKey: ['children', payload.parentNodeId] });
          } else {
            queryClient.invalidateQueries({ queryKey: ['tree', null] });
          }
          invalidateCompile(payload);
          break;

        case 'node:deleted':
          applyToAllChildrenCaches(payload);
          queryClient.removeQueries({ queryKey: ['node', payload.nodeId] });
          invalidateCompile(payload);
          break;

        case 'node:moved':
          // 기존 위치에서 surgical 제거
          applyToAllChildrenCaches(payload);
          // 새 위치는 position 정보 없어 invalidate fallback
          if (payload.newParentNodeId) {
            queryClient.invalidateQueries({ queryKey: ['children', payload.newParentNodeId] });
          } else {
            queryClient.invalidateQueries({ queryKey: ['tree', null] });
          }
          invalidateCompile(payload);
          break;

        case 'batch:completed':
          // 복수 연산 결과 — 전체 재페치 fallback
          queryClient.invalidateQueries({ queryKey: ['tree', null] });
          queryClient.invalidateQueries({ queryKey: ['children'] });
          queryClient.invalidateQueries({ queryKey: ['node'] });
          invalidateCompile(payload);
          break;
      }
    }

    return () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
      es.close();
    };
    // selectedNodeId는 compile invalidation 범위를 결정하므로 의존성에 포함
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, selectedNodeId]);
}
