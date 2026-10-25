import type { MotionNode } from './types';
import type { MotionEvent } from './stream';
export interface MotionPlayer {
  begin(query: string): void;
  receive(event: MotionEvent): void;
  error(message: string): void;
  dispose(): void;
}
export function createMotionPlayer(root: HTMLElement, callbacks: {
  onSummary?(summary: string): void;
  onResults(nodes: MotionNode[]): void;
  onSelect(node: MotionNode): void;
  onMore(query: string): void;
  onCancel(): void;
}, samples: unknown): MotionPlayer;
