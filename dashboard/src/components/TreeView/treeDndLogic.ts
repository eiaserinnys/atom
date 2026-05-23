import type { TreeNodeData } from '../../api/client';
import type { DropZone } from './TreeDndContext';

export function findNodeInTree(nodeId: string, nodes: TreeNodeData[]): TreeNodeData | null {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    if (node.children) {
      const found = findNodeInTree(nodeId, node.children);
      if (found) return found;
    }
  }
  return null;
}

export function isAncestorOf(ancestorId: string, targetId: string, nodes: TreeNodeData[]): boolean {
  function hasDescendant(node: TreeNodeData, id: string): boolean {
    if (!node.children) return false;
    return node.children.some(c => c.id === id || hasDescendant(c, id));
  }
  const ancestor = findNodeInTree(ancestorId, nodes);
  if (!ancestor) return false;
  return hasDescendant(ancestor, targetId);
}

export function calcDropZone(
  pointerY: number,
  overRectTop: number,
  overRectHeight: number,
  isStructure: boolean
): DropZone {
  const relativeY = pointerY - overRectTop;
  const ratio = relativeY / overRectHeight;

  if (ratio < 0.3) return 'above';
  if (ratio > 0.7) return 'below';
  return isStructure ? 'into' : (ratio < 0.5 ? 'above' : 'below');
}
