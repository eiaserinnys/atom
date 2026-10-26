export interface InitialExplorationCard {
  card_id?: string;
  cardId?: string;
  node_id?: string | null;
  nodeId?: string | null;
  card_type?: 'structure' | 'knowledge';
  cardType?: 'structure' | 'knowledge';
  title?: string;
  path?: Array<{ node_id: string; title: string }>;
  excerpt?: string;
  similarity?: number | null;
  tree_relation?: unknown;
  display_column_id?: string;
  column_label?: string;
  selected?: boolean;
  rank?: number;
  score?: number | null;
  initial_evaluation?: { score: number; call_id?: string; question_key?: string };
  version?: number;
  card_version?: number;
  [key: string]: unknown;
}

export interface ExplorationModel {
  query: string;
  selectionThreshold: number;
  cards: Map<string, Record<string, any>>;
  cardOrder: string[];
  columns: Array<{ id: string; label: string; cardIds: string[]; referenceIds: string[] }>;
  references: Array<Record<string, any>>;
  edges: Map<string, Record<string, any>>;
  operations: Array<Record<string, any>>;
  evaluationCache: Map<string, Record<string, any>>;
  resultOrder: string[];
  nextDiscoveryOrder: number;
}

export interface ExplorationProjection {
  query: string;
  selectionThreshold: number;
  cards: Array<Record<string, any>>;
  columns: Array<{ id: string; label: string; cardIds: string[]; referenceIds: string[] }>;
  references: Array<Record<string, any>>;
  resultOrder: string[];
  results: Array<{ cardId: string; rank: number; score: number | null; sourceLabel: string }>;
  operations: Array<Record<string, any>>;
  evaluations: Map<string, Record<string, any>>;
}

export function createExplorationModel(input: { query: string; selectionThreshold?: number | null; initialCards: InitialExplorationCard[] }): ExplorationModel;
export function applyExplorationEvent(model: ExplorationModel, event: import('./operation-types').VisualOperationEvent | Record<string, any>): ExplorationModel;
export function projectExploration(model: ExplorationModel): ExplorationProjection;
