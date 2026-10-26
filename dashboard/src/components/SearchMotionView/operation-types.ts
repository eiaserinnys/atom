import type { CardData } from '../../api/types';

export type OperationKind = 'expand' | 'evaluate';
export type OperationStatus = 'running' | 'succeeded' | 'failed';

export interface OperationRecord {
  id: string;
  kind: OperationKind;
  fromCardId: string | null;
  query: string | null;
  viaOperationId: string | null;
  requestedCardIds: string[];
  resultCardIds: string[];
  status: OperationStatus;
  errorCode: string | null;
  auditCalls: JevAuditCall[];
}

export interface JevAuditCall {
  call_id: string;
  run_id: string;
  seq: number;
  stage: string;
  candidate_count: number;
  disposition: 'completed' | 'skipped' | 'error';
  started_at: string;
  completed_at: string | null;
  latency_ms: number | null;
  usage: { input_tokens: number; output_tokens: number | null } | null;
  request: Record<string, unknown>;
  response: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
}

export interface VisualSearchNeighbor {
  card_id: string;
  node_id: string;
  card_type: CardData['card_type'];
  title: string;
  similarity: number;
  excerpt: string;
  path: Array<{ node_id: string; title: string }>;
  tree_relation: {
    common_ancestor_depth: number;
    tree_distance: number;
    same_top_level_branch: boolean;
  } | null;
}

export interface VisualSearchNeighborsResponse {
  status: 'ready';
  model: string;
  dimensions: number;
  key_configured: boolean;
  index: { indexed_cards: number };
  source?: {
    card_id: string;
    node_id: string;
    title: string;
    path: Array<{ node_id: string; title: string }>;
  };
  neighbors: VisualSearchNeighbor[];
}

export interface EvaluationResult {
  card_id: string;
  node_id: string;
  card_version: number;
  score: number;
  call_id: string;
  question_key: string;
}

export interface EvaluationResponse {
  evaluation_id: string;
  query: string;
  model: string;
  results: EvaluationResult[];
  skipped: Array<{ card_id: string; reason: 'CARD_NOT_FOUND' | 'NO_BODY' | 'NO_CANONICAL_NODE' }>;
  audit: { calls: JevAuditCall[] };
}

export interface VisualOperationStarted {
  type: 'started';
  id: string;
  kind: OperationKind;
  fromCardId: string | null;
  query: string | null;
  viaOperationId: string | null;
  requestedCardIds: string[];
}

export type VisualOperationEvent =
  | VisualOperationStarted
  | { type: 'index_loading'; operationId: string }
  | { type: 'expansion_succeeded'; operationId: string; response: VisualSearchNeighborsResponse }
  | { type: 'evaluations_reused'; operationId: string; cardIds: string[] }
  | { type: 'evaluation_batch_succeeded'; operationId: string; response: EvaluationResponse }
  | { type: 'completed'; operationId: string }
  | { type: 'failed'; operationId: string; errorCode: string; auditCalls?: JevAuditCall[] };

export interface OperationSnapshot {
  selectedCardId: string | null;
  live: boolean;
  initialSearchComplete: boolean;
  query: string;
  context: { agent: string | null; project: string | null; task: string | null };
  selectionThreshold: number;
  evaluationTargetCardIds: string[];
  activeOperation: OperationRecord | null;
  operations: OperationRecord[];
  resultOrder: string[];
  selectedArrivalOperationId: string | null;
}
