import { QueryClient } from '@tanstack/react-query';
import { describe, expect, test, vi } from 'vitest';
import { invalidateSseReconnectQueries } from './invalidation';

function collectInvalidatedKeys(calls: Array<Parameters<QueryClient['invalidateQueries']>>) {
  return calls.map(([filters]) => filters?.queryKey);
}

describe('dashboard query invalidation helpers', () => {
  test('preserves SSE reconnect invalidation scope with selected node compile caches', () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    invalidateSseReconnectQueries(queryClient, 'node-1');

    expect(collectInvalidatedKeys(invalidateSpy.mock.calls)).toEqual([
      ['tree', null],
      ['children'],
      ['node'],
      ['compile', 'node-1'],
      ['compile-unfurl', 'node-1'],
    ]);
  });

  test('preserves SSE reconnect invalidation scope without selected node compile caches', () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    invalidateSseReconnectQueries(queryClient, null);

    expect(collectInvalidatedKeys(invalidateSpy.mock.calls)).toEqual([
      ['tree', null],
      ['children'],
      ['node'],
    ]);
  });
});
