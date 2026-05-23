import type { QueryClient } from '@tanstack/react-query';
import {
  allChildrenQueryKey,
  allNodeQueryKey,
  allTreeQueryKey,
  rootTreeQueryKey,
  standardCompileNodeQueryKey,
  unfurlCompileNodeQueryKey,
} from './queryKeys';

export function invalidateTreeMutationQueries(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: allTreeQueryKey() });
  queryClient.invalidateQueries({ queryKey: allChildrenQueryKey() });
}

export function invalidateSelectedCompileQueries(
  queryClient: QueryClient,
  selectedNodeId: string | null
): void {
  if (selectedNodeId === null) return;
  queryClient.invalidateQueries({ queryKey: standardCompileNodeQueryKey(selectedNodeId) });
  queryClient.invalidateQueries({ queryKey: unfurlCompileNodeQueryKey(selectedNodeId) });
}

export function invalidateSseReconnectQueries(
  queryClient: QueryClient,
  selectedNodeId: string | null
): void {
  queryClient.invalidateQueries({ queryKey: rootTreeQueryKey() });
  queryClient.invalidateQueries({ queryKey: allChildrenQueryKey() });
  queryClient.invalidateQueries({ queryKey: allNodeQueryKey() });
  invalidateSelectedCompileQueries(queryClient, selectedNodeId);
}
