// AtomEvent 타입 — 백엔드 eventBus.ts의 타입을 미러링 (빌드 분리 유지)
export type AtomEvent =
  | { type: 'card:created'; cardId: string; nodeId: string; parentNodeId: string | null }
  | { type: 'card:updated'; cardId: string }
  | { type: 'card:deleted'; cardId: string }
  | { type: 'node:created'; nodeId: string; parentNodeId: string | null }
  | { type: 'node:deleted'; nodeId: string }
  | { type: 'node:moved'; nodeId: string; newParentNodeId: string | null }
  | { type: 'batch:completed' };
