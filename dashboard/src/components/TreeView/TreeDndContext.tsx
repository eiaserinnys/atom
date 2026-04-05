import { createContext, useContext } from 'react';

export type DropZone = 'above' | 'into' | 'below';

export interface TreeDndState {
  activeId: string | null;
  overId: string | null;
  dropZone: DropZone | null;
}

export const TreeDndContext = createContext<TreeDndState>({
  activeId: null,
  overId: null,
  dropZone: null,
});

export function useTreeDnd() {
  return useContext(TreeDndContext);
}
