// AtomEvent 타입 — 백엔드 eventBus.ts의 타입을 미러링 (빌드 분리 유지)
// client.ts는 events.ts를 import하지 않으므로 순환 참조 없음
import type { CardData, TreeNodeData } from '../api/client';

export type BatchOpResult = {
  created: { temp_id: string; card_id: string; node_id: string }[];
  symlinked: string[];
  updated: string[];
  node_updated: string[];
  moved: string[];
  child_ordered: (string | null)[];
  deleted: string[];
  _warnings?: string[];
};

export type AtomPatchEvent =
  | { type: 'card:created'; cardId: string; nodeId: string; parentNodeId: string | null; data: CardData; node: TreeNodeData; actor: string | null }
  | { type: 'card:updated'; cardId: string; data: CardData; actor: string | null }
  | { type: 'card:deleted'; cardId: string; nodeIds: string[]; parentNodeIds: (string | null)[]; actor: string | null }
  | { type: 'node:created'; nodeId: string; cardId: string; parentNodeId: string | null; node: TreeNodeData; actor: string | null }
  | { type: 'node:updated'; nodeId: string; node: TreeNodeData; actor: string | null }
  | { type: 'node:deleted'; nodeId: string; cardId: string; parentNodeId: string | null; actor: string | null }
  | { type: 'node:moved'; nodeId: string; oldParentNodeId: string | null; newParentNodeId: string | null; node: TreeNodeData; affectedNodes: TreeNodeData[]; actor: string | null };

export type AtomEvent =
  | AtomPatchEvent
  | { type: 'batch:completed'; result: BatchOpResult; patches: AtomPatchEvent[] };
