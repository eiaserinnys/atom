import { useQuery } from '@tanstack/react-query';
import { api, type UnfurlEntry } from '../../api/client';
import { readStoredCredentials } from '../../hooks/useLocalStorageCredentials';

export function standardCompileQueryKey(nodeId: string | null, depth: number) {
  return ['compile', nodeId, depth] as const;
}

export function unfurlCompileQueryKey(nodeId: string | null, depth: number) {
  return ['compile-unfurl', nodeId, depth] as const;
}

export function useCompileQueries(nodeId: string | null, depth: number, unfurlEnabled: boolean) {
  const standardQuery = useQuery({
    queryKey: standardCompileQueryKey(nodeId, depth),
    queryFn: async () => {
      const result = await api.compile(nodeId!, { depth, numbering: true, include_ids: true });
      return { markdown: result.markdown };
    },
    enabled: !!nodeId && !unfurlEnabled,
  });

  const unfurlQuery = useQuery({
    queryKey: unfurlCompileQueryKey(nodeId, depth),
    queryFn: async () => {
      return api.compileWithRefs(nodeId!, depth, 'cached', readStoredCredentials());
    },
    enabled: !!nodeId && unfurlEnabled,
  });

  const activeQuery = unfurlEnabled ? unfurlQuery : standardQuery;
  const unfurls: Record<string, UnfurlEntry> | null = unfurlEnabled
    ? (unfurlQuery.data?.unfurls ?? null)
    : null;

  return {
    markdown: activeQuery.data?.markdown,
    isLoading: activeQuery.isLoading,
    error: activeQuery.error,
    unfurls,
  };
}
