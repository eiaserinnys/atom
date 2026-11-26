import { useQuery } from '@tanstack/react-query';
import { api, type TreeNodeData } from '../../api/client';
import { deletePreviewQueryKey } from '../../query/queryKeys';
import type { DeletePreviewState } from '../DeleteConfirmModal/DeleteConfirmModal';

export function useDeletePreview(node: TreeNodeData | null): DeletePreviewState | undefined {
  const needsPreview = node !== null && !node.is_symlink;
  const query = useQuery({
    queryKey: deletePreviewQueryKey(node?.id ?? ''),
    queryFn: () => api.getDeletePreview(node!.id),
    enabled: needsPreview,
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });

  if (!needsPreview) return undefined;
  if (query.isError) return { status: 'error' };
  if (query.data) return { status: 'ready', deletedCardCount: query.data.deleted_card_count };
  return { status: 'loading' };
}
