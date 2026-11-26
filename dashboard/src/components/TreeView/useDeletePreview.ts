import { useQuery } from '@tanstack/react-query';
import { api, type TreeNodeData } from '../../api/client';
import { deletePreviewQueryKey } from '../../query/queryKeys';
import type { DeletePreviewState } from '../DeleteConfirmModal/DeleteConfirmModal';

export function useDeletePreview(node: TreeNodeData | null): DeletePreviewState | undefined {
  const query = useQuery({
    queryKey: deletePreviewQueryKey(node?.id ?? ''),
    queryFn: () => api.getDeletePreview(node!.id),
    enabled: node !== null,
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });

  if (node === null) return undefined;
  if (query.isError) return { status: 'error' };
  if (query.data) return {
    status: 'ready',
    deletedCardCount: query.data.deleted_card_count,
    deletedLinkCount: query.data.deleted_link_count,
  };
  return { status: 'loading' };
}
