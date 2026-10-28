import { useQuery } from '@tanstack/react-query';
import { compileApi } from '../../api/compileApi';
import type { UnfurlEntry } from '../../api/client';
import { readStoredCredentials } from '../../hooks/useLocalStorageCredentials';
import { compileSectionsQueryKey, unfurlSectionsQueryKey } from '../../query/queryKeys';

export { standardCompileQueryKey, unfurlCompileQueryKey } from '../../query/queryKeys';

export function useCompileQueries(nodeId: string | null, depth: number, unfurlEnabled: boolean) {
  const standardQuery = useQuery({
    queryKey: compileSectionsQueryKey(nodeId, depth),
    queryFn: () => compileApi.sections(nodeId!, depth, 60000),
    enabled: !!nodeId && !unfurlEnabled,
  });

  const unfurlQuery = useQuery({
    queryKey: unfurlSectionsQueryKey(nodeId, depth),
    queryFn: () => compileApi.sectionsWithRefs(nodeId!, depth, 'cached', readStoredCredentials(), 60000),
    enabled: !!nodeId && unfurlEnabled,
  });

  const activeQuery = unfurlEnabled ? unfurlQuery : standardQuery;
  const unfurls: Record<string, UnfurlEntry> | null = unfurlEnabled
    ? (unfurlQuery.data?.unfurls ?? null)
    : null;

  return {
    sections: activeQuery.data?.sections,
    isLoading: activeQuery.isLoading,
    error: activeQuery.error,
    unfurls,
  };
}
