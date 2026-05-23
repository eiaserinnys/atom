import { useEffect, useRef, useState } from 'react';
import {
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import type { TreeNodeData } from '../../api/client';
import { buildMovePayload, type TreeMovePayload } from '../../utils/treeMoveIntent';
import type { DropZone, TreeDndState } from './TreeDndContext';
import { calcDropZone, isAncestorOf } from './treeDndLogic';

interface UseTreeDragAndDropArgs {
  roots: TreeNodeData[] | undefined;
  onMove: (payload: TreeMovePayload) => void;
}

export function useTreeDragAndDrop({ roots, onMove }: UseTreeDragAndDropArgs) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeDragNode, setActiveDragNode] = useState<TreeNodeData | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [dropZone, setDropZone] = useState<DropZone | null>(null);

  // DnD events can read stale React state between pointer movement and drop.
  // Refs keep the pointer/drop zone values current for handleDragEnd.
  const pointerYRef = useRef<number | null>(null);
  const dropZoneRef = useRef<DropZone | null>(null);

  useEffect(() => {
    if (!activeId) return;
    const onPointerMove = (e: PointerEvent) => { pointerYRef.current = e.clientY; };
    window.addEventListener('pointermove', onPointerMove);
    return () => window.removeEventListener('pointermove', onPointerMove);
  }, [activeId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  function resetDragState() {
    pointerYRef.current = null;
    dropZoneRef.current = null;
    setActiveDragNode(null);
    setActiveId(null);
    setOverId(null);
    setDropZone(null);
  }

  function clearDropTarget() {
    setOverId(null);
    setDropZone(null);
    dropZoneRef.current = null;
  }

  function handleDragStart(event: DragStartEvent) {
    const activeData = event.active.data.current as { node?: TreeNodeData } | undefined;
    setActiveDragNode(activeData?.node ?? null);
    setActiveId(event.active.id as string);
  }

  function applyDropZone(over: DragOverEvent['over'] | DragMoveEvent['over']): void {
    if (!over) { clearDropTarget(); return; }

    const overData = over.data.current as { node?: TreeNodeData } | undefined;
    if (!overData?.node) { clearDropTarget(); return; }
    const overNode = overData.node;
    const overRect = over.rect;

    const currentPointerY = pointerYRef.current;
    if (currentPointerY === null || !overRect) {
      const fallbackZone: DropZone = overNode.card.card_type === 'structure' ? 'into' : 'above';
      setOverId(overNode.id);
      setDropZone(fallbackZone);
      dropZoneRef.current = fallbackZone;
      return;
    }

    const zone = calcDropZone(
      currentPointerY,
      overRect.top,
      overRect.height,
      overNode.card.card_type === 'structure'
    );
    setOverId(overNode.id);
    setDropZone(zone);
    dropZoneRef.current = zone;
  }

  function handleDragMove(event: DragMoveEvent) { applyDropZone(event.over); }
  function handleDragOver(event: DragOverEvent) { applyDropZone(event.over); }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    const currentDropZone = dropZoneRef.current;
    if (over && currentDropZone && roots) {
      const overData = over.data.current as { node?: TreeNodeData } | undefined;
      const targetNode = overData?.node;

      if (targetNode && activeDragNode && active.id !== targetNode.id) {
        const circular = isAncestorOf(active.id as string, targetNode.id, roots);

        if (!circular) {
          onMove(buildMovePayload(active.id as string, targetNode, currentDropZone));
        }
      }
    }

    resetDragState();
  }

  const dndState: TreeDndState = { activeId, overId, dropZone };

  return {
    activeDragNode,
    dndState,
    sensors,
    handleDragStart,
    handleDragMove,
    handleDragOver,
    handleDragEnd,
    handleDragCancel: resetDragState,
  };
}
