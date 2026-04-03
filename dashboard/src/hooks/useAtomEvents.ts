import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AtomEvent } from '../types/events';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export function useAtomEvents() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const es = new EventSource(`${BASE_URL}/events`, { withCredentials: true });

    es.onmessage = (event) => {
      try {
        const payload: AtomEvent = JSON.parse(event.data);
        handleEvent(payload);
      } catch {
        console.warn('[useAtomEvents] 파싱 실패:', event.data);
      }
    };

    es.onerror = () => {
      console.warn('[useAtomEvents] SSE 연결 오류. 자동 재연결 시도 중...');
    };

    function handleEvent(payload: AtomEvent) {
      switch (payload.type) {
        case 'card:created':
          queryClient.invalidateQueries({ queryKey: ['tree', null] });
          if (payload.parentNodeId) {
            queryClient.invalidateQueries({ queryKey: ['children', payload.parentNodeId] });
          }
          break;

        case 'card:updated':
          queryClient.invalidateQueries({ queryKey: ['node'] });
          queryClient.invalidateQueries({ queryKey: ['compile'] });
          break;

        case 'card:deleted':
          queryClient.invalidateQueries({ queryKey: ['tree'] });
          queryClient.invalidateQueries({ queryKey: ['node'] });
          queryClient.invalidateQueries({ queryKey: ['children'] });
          break;

        case 'node:created':
          queryClient.invalidateQueries({ queryKey: ['tree', null] });
          if (payload.parentNodeId) {
            queryClient.invalidateQueries({ queryKey: ['children', payload.parentNodeId] });
          }
          break;

        case 'node:deleted':
          queryClient.invalidateQueries({ queryKey: ['tree'] });
          queryClient.invalidateQueries({ queryKey: ['node'] });
          queryClient.invalidateQueries({ queryKey: ['children'] });
          break;

        case 'node:moved':
          queryClient.invalidateQueries({ queryKey: ['tree'] });
          break;

        case 'batch:completed':
          queryClient.invalidateQueries({ queryKey: ['tree', null] });
          queryClient.invalidateQueries({ queryKey: ['children'] });
          queryClient.invalidateQueries({ queryKey: ['node'] });
          break;
      }
    }

    return () => {
      es.close();
    };
  }, [queryClient]);
}
