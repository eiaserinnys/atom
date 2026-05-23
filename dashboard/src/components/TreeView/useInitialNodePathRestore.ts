import { useEffect, type Dispatch, type SetStateAction } from 'react';

interface NodeParent {
  parent_node_id: string | null;
}

export type GetNodeForPath = (nodeId: string) => Promise<NodeParent>;

export interface InitialNodePathRestoreEffects {
  expandAncestors: (nodeIds: string[]) => void;
  selectNode: (nodeId: string) => void;
}

export interface InitialNodePathRestoreInput {
  targetId: string;
  path: string[];
}

export async function resolveNodePath(
  getNode: GetNodeForPath,
  targetId: string
): Promise<string[]> {
  const path: string[] = [];
  let currentId: string | null = targetId;

  while (currentId) {
    try {
      const node = await getNode(currentId);
      path.unshift(currentId);
      currentId = node.parent_node_id ?? null;
    } catch {
      break;
    }
  }

  return path;
}

export function applyInitialNodePathRestore(
  input: InitialNodePathRestoreInput,
  effects: InitialNodePathRestoreEffects
): void {
  if (input.path.length === 0) return;

  effects.expandAncestors(input.path.slice(0, -1));
  effects.selectNode(input.targetId);
}

export interface RestoreInitialNodePathInput extends InitialNodePathRestoreEffects {
  targetId: string | undefined;
  rootsLoaded: boolean;
  getNode: GetNodeForPath;
}

export async function restoreInitialNodePath(input: RestoreInitialNodePathInput): Promise<void> {
  if (!input.targetId || !input.rootsLoaded) return;

  const path = await resolveNodePath(input.getNode, input.targetId);
  applyInitialNodePathRestore({ targetId: input.targetId, path }, input);
}

export interface UseInitialNodePathRestoreInput {
  initialSelectedNodeId: string | undefined;
  roots: readonly unknown[] | undefined;
  getNode: GetNodeForPath;
  setExpandedNodes: Dispatch<SetStateAction<Set<string>>>;
  onSelect: (nodeId: string | null) => void;
}

export function useInitialNodePathRestore({
  initialSelectedNodeId,
  roots,
  getNode,
  setExpandedNodes,
  onSelect,
}: UseInitialNodePathRestoreInput): void {
  useEffect(() => {
    void restoreInitialNodePath({
      targetId: initialSelectedNodeId,
      rootsLoaded: Boolean(roots?.length),
      getNode,
      expandAncestors: (nodeIds) => {
        setExpandedNodes(prev => {
          const next = new Set(prev);
          nodeIds.forEach(id => next.add(id));
          return next;
        });
      },
      selectNode: onSelect,
    });
  // Preserve the legacy TreeView behavior: initial restore is tied to roots query updates.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots]);
}
