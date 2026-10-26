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

export function getDeleteErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function applyDeleteError(error: unknown, effects: TreeMutationSideEffects, fallback: string): void {
  effects.setDeleteError(getDeleteErrorMessage(error, fallback));
}

export function applyMoveSuccess(): void {
  // Data updates arrive through SSE. Caller-specific modal close stays in mutate options.
}
