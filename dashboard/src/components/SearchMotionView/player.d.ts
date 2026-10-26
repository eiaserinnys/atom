import type { MotionNode } from './types';
import type { MotionEvent } from './stream';
import type { OperationSnapshot, VisualOperationEvent } from './operation-types';
import type { ExplorationLog } from './exploration-session';
export interface CameraPosition { x: number; y: number; z: number }
export interface ExplorationRecord {
  log: ExplorationLog;
  cursor: number;
  camera: CameraPosition;
  complete: boolean;
}
export interface MotionPlayer {
  begin(query: string, options?: { resume?: boolean }): void;
  getCamera(): CameraPosition;
  getRecord(): ExplorationRecord;
  restoreRecord(record: ExplorationRecord): boolean;
  getSnapshot(): OperationSnapshot;
  refreshPaths(): void;
  applyOperation(event: VisualOperationEvent, expectedRevision?: number): boolean;
  receive(event: MotionEvent): void;
  error(message: string): void;
  dispose(): void;
}
export function createMotionPlayer(root: HTMLElement, callbacks: {
  onSummary?(summary: string): void;
  onResults(nodes: MotionNode[]): void;
  onSelect(node: MotionNode | null): void;
  onMore(query: string, snapshot: OperationSnapshot): void;
  onOperationRequest?(kind: 'expand' | 'evaluate', snapshot: OperationSnapshot): void;
  onOpenInTree?(nodeId: string): void;
  translate?(key: string, values?: Record<string, unknown>): string;
  onCancel(): void;
  getCachedTreeNodes?(): unknown[];
}, samples?: unknown): MotionPlayer;
