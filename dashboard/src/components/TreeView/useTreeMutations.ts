import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { TreeMovePayload } from '../../utils/treeMoveIntent';
import {
  applyCreateSuccess,
  applyDeleteError,
  applyDeleteSuccess,
  applyEditSuccess,
  applyMoveSuccess,
  type TreeMutationSideEffects,
} from './treeMutationEffects';
import {
  buildCreateCardPayload,
  buildEditCardPayload,
  buildMoveNodePayload,
  type CreateCardVars,
  type EditCardVars,
} from './treeMutationPayloads';

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
  const expandParent = useCallback((nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      next.add(nodeId);
      return next;
    });
  }, [setExpandedNodes]);

  const mutationEffects = useMemo<TreeMutationSideEffects>(() => ({
    expandParent,
    selectNode: onSelect,
    closeModal,
    clearDeleteError: () => setDeleteError(null),
    setDeleteError,
  }), [expandParent, onSelect, closeModal, setDeleteError]);

  const createMutation = useMutation({
    mutationFn: (vars: CreateCardVars) =>
      api.createCard(buildCreateCardPayload(vars)),
    onSuccess: (result, vars) => {
      applyCreateSuccess({
        createdNodeId: result.node_id,
        parentNodeId: vars.parentNodeId ?? null,
      }, mutationEffects);
    },
  });

  const editMutation = useMutation({
    mutationFn: (vars: EditCardVars) =>
      api.updateCard(vars.cardId, buildEditCardPayload(vars)),
    onSuccess: () => {
      applyEditSuccess(mutationEffects);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (nodeId: string) => api.deleteNode(nodeId),
    onSuccess: (_data, nodeId) => {
      applyDeleteSuccess({
        deletedNodeId: nodeId,
        selectedNodeId,
      }, mutationEffects);
    },
    onError: (err) => {
      applyDeleteError(err, mutationEffects);
    },
  });

  const moveMutation = useMutation({
    mutationFn: (vars: TreeMovePayload) =>
      api.moveNode(vars.nodeId, buildMoveNodePayload(vars)),
    onSuccess: () => applyMoveSuccess(),
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
