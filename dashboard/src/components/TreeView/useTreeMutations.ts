import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { toApiMovePayload, type TreeMovePayload } from '../../utils/treeMoveIntent';
import { invalidateTreeMutationQueries } from '../../query/invalidation';

type CardType = 'structure' | 'knowledge';

interface CreateCardVars {
  cardType: CardType;
  title: string;
  content: string;
  parentNodeId?: string | null;
}

interface EditCardVars {
  cardId: string;
  title: string;
  content: string;
}

interface UseTreeMutationsArgs {
  selectedNodeId: string | null;
  onSelect: (nodeId: string | null) => void;
  setExpandedNodes: Dispatch<SetStateAction<Set<string>>>;
  closeModal: () => void;
  setDeleteError: Dispatch<SetStateAction<string | null>>;
}

export function useTreeMutations({
  selectedNodeId,
  onSelect,
  setExpandedNodes,
  closeModal,
  setDeleteError,
}: UseTreeMutationsArgs) {
  const queryClient = useQueryClient();

  const invalidateTree = useCallback(() => {
    invalidateTreeMutationQueries(queryClient);
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: (vars: CreateCardVars) =>
      api.createCard({
        card_type: vars.cardType,
        title: vars.title,
        content: vars.content || undefined,
        parent_node_id: vars.parentNodeId ?? null,
      }),
    onSuccess: (result, vars) => {
      invalidateTree();
      if (vars.parentNodeId) {
        setExpandedNodes(prev => { const n = new Set(prev); n.add(vars.parentNodeId!); return n; });
      }
      onSelect(result.node_id);
      closeModal();
    },
  });

  const editMutation = useMutation({
    mutationFn: (vars: EditCardVars) =>
      api.updateCard(vars.cardId, { title: vars.title, content: vars.content || undefined }),
    onSuccess: () => {
      invalidateTree();
      closeModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (nodeId: string) => api.deleteNode(nodeId),
    onSuccess: (_data, nodeId) => {
      if (selectedNodeId === nodeId) onSelect(null);
      invalidateTree();
      closeModal();
      setDeleteError(null);
    },
    onError: (err) => {
      setDeleteError(err instanceof Error ? err.message : '삭제 중 오류가 발생했습니다.');
    },
  });

  const moveMutation = useMutation({
    mutationFn: (vars: TreeMovePayload) =>
      api.moveNode(vars.nodeId, toApiMovePayload(vars)),
    onSuccess: () => invalidateTree(),
  });

  return {
    createMutation,
    editMutation,
    deleteMutation,
    moveMutation,
    createCard: createMutation.mutate,
    editCard: editMutation.mutate,
    deleteNode: deleteMutation.mutate,
    moveNode: moveMutation.mutate,
    isFormMutating: createMutation.isPending || editMutation.isPending || deleteMutation.isPending,
  };
}
