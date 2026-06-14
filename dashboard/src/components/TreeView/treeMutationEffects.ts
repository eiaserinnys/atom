const DELETE_ERROR_FALLBACK = '삭제 중 오류가 발생했습니다.';

export interface TreeMutationSideEffects {
  expandParent: (nodeId: string) => void;
  selectNode: (nodeId: string | null) => void;
  closeModal: () => void;
  clearDeleteError: () => void;
  setDeleteError: (message: string) => void;
}

export interface CreateSuccessInput {
  createdNodeId: string;
  parentNodeId: string | null;
}

export interface DeleteSuccessInput {
  deletedNodeId: string;
  selectedNodeId: string | null;
}

export function applyCreateSuccess(
  input: CreateSuccessInput,
  effects: TreeMutationSideEffects
): void {
  if (input.parentNodeId) {
    effects.expandParent(input.parentNodeId);
  }
  effects.selectNode(input.createdNodeId);
  effects.closeModal();
}

export function applyEditSuccess(effects: TreeMutationSideEffects): void {
  effects.closeModal();
}

export function applyDeleteSuccess(
  input: DeleteSuccessInput,
  effects: TreeMutationSideEffects
): void {
  if (input.selectedNodeId === input.deletedNodeId) {
    effects.selectNode(null);
  }
  effects.closeModal();
  effects.clearDeleteError();
}

export function getDeleteErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : DELETE_ERROR_FALLBACK;
}

export function applyDeleteError(error: unknown, effects: TreeMutationSideEffects): void {
  effects.setDeleteError(getDeleteErrorMessage(error));
}

export function applyMoveSuccess(): void {
  // Data updates arrive through SSE. Caller-specific modal close stays in mutate options.
}
