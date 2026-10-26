import type { NeighborPathEntry } from "./embeddings.js";
import type { CardType } from "./types.js";

export interface QueryExpansionInput {
  query: string;
  exclude_card_ids: string[];
  limit?: number;
}

export interface QueryExpansionNeighbor {
  card_id: string;
  node_id: string;
  card_type: CardType;
  title: string;
  similarity: number;
  excerpt: string;
  path: NeighborPathEntry[];
  tree_relation: null;
}

export interface QueryExpansionResponse {
  status: "ready";
  model: string;
  dimensions: number;
  key_configured: boolean;
  index: { indexed_cards: number };
  query: { text: string; token_count: number; truncated: boolean };
  neighbors: QueryExpansionNeighbor[];
}

export interface QueryExpansionError {
  error: { code: string };
  key_configured?: boolean;
}
