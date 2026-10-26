import type { MotionNode } from './types';
import type { MotionEvent } from './stream';
import type { OperationSnapshot, VisualOperationEvent } from './operation-types';
export interface MotionPlayer {
  begin(query: string, options?: { resume?: boolean }): void;
  getSnapshot(): OperationSnapshot;
  applyOperation(event: VisualOperationEvent, expectedRevision?: number): boolean;
  receive(event: MotionEvent): void;
  error(message: string): void;
  dispose(): void;
}
export function createMotionPlayer(root: HTMLElement, callbacks: {
  onSummary?(summary: string): void;
  onResults(nodes: MotionNode[]): void;
  onSelect(node: MotionNode): void;
  onMore(query: string, snapshot: OperationSnapshot): void;
  onOperationRequest?(kind: 'expand' | 'evaluate', snapshot: OperationSnapshot): void;
  onOpenInTree?(nodeId: string): void;
  translate?(key: string, values?: Record<string, unknown>): string;
  onCancel(): void;
}, samples: unknown): MotionPlayer;
