export type EmbeddingPauseReason = "no_key" | "auth" | "rate_limited" | null;

export type EmbeddingErrorKind =
  | "OPENAI_AUTH"
  | "OPENAI_RATE_LIMIT"
  | "OPENAI_UPSTREAM"
  | "OPENAI_NETWORK"
  | "OPENAI_REQUEST"
  | "OPENAI_BAD_RESPONSE"
  | "EMBEDDING_STORAGE";

export interface OpenAIConfigResponse {
  key: { configured: boolean; last_saved_at: string | null };
  embedding: {
    model: string;
    dimensions: number;
    completed_cards: number;
    target_cards: number;
    running: boolean;
    paused_reason: EmbeddingPauseReason;
    last_error: { kind: EmbeddingErrorKind; http_status: number | null } | null;
  };
}

export interface NeighborPathEntry {
  node_id: string;
  title: string;
}

export interface CardNeighbor {
  card_id: string;
  node_id: string;
  title: string;
  similarity: number;
  excerpt: string;
  path: NeighborPathEntry[];
  tree_relation: {
    common_ancestor_depth: number;
    tree_distance: number;
    same_top_level_branch: boolean;
  };
}

export interface CardNeighborsResponse {
  status: "ready";
  model: string;
  dimensions: number;
  key_configured: boolean;
  index: { indexed_cards: number };
  source: {
    card_id: string;
    node_id: string;
    title: string;
    path: NeighborPathEntry[];
  };
  neighbors: CardNeighbor[];
}
