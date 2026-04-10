// AtomEvent 타입 — 백엔드 eventBus.ts의 타입을 미러링 (빌드 분리 유지)
// client.ts는 events.ts를 import하지 않으므로 순환 참조 없음
import type { CardData } from '../api/client';

export type AtomEvent =
  | { type: 'card:created'; cardId: string; nodeId: string; parentNodeId: string | null; data: CardData; actor: string | null }
  | { type: 'card:updated'; cardId: string; data: CardData; actor: string | null }
  | { type: 'card:deleted'; cardId: string; actor: string | null }
  | { type: 'node:created'; nodeId: string; cardId: string; parentNodeId: string | null }
  | { type: 'node:deleted'; nodeId: string }
  | { type: 'node:moved'; nodeId: string; newParentNodeId: string | null }
  | { type: 'batch:completed'; result?: unknown };
