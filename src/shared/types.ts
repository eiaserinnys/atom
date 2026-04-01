export type CardType = "structure" | "knowledge";

export type Staleness = "unverified" | "fresh" | "stale" | "outdated";

export interface Card {
  id: string;
  card_type: CardType;
  title: string;
  content: string | null;
  references: string[];
  tags: string[];
  card_timestamp: string;
  content_timestamp: string | null;
  source_type: string | null;
  source_ref: string | null;
  source_snapshot: string | null;
  source_checksum: string | null;
  source_checked_at: string | null;
  staleness: Staleness;
  version: number;
  updated_at: string;
}

export interface TreeNode {
  id: string;
  card_id: string;
  parent_node_id: string | null;
  position: number;
  is_symlink: boolean;
  created_at: string;
}

export interface TreeNodeWithCard extends TreeNode {
  card: Card;
}

export interface CreateCardInput {
  card_type: CardType;
  title: string;
  content?: string | null;
  parent_node_id?: string | null;
  position?: number;
  tags?: string[];
  references?: string[];
  content_timestamp?: string | null;
  source_type?: string | null;
  source_ref?: string | null;
}

export interface UpdateCardInput {
  title?: string;
  content?: string | null;
  tags?: string[];
  references?: string[];
  content_timestamp?: string | null;
  source_type?: string | null;
  source_ref?: string | null;
  source_snapshot?: string | null;
  source_checksum?: string | null;
  source_checked_at?: string | null;
}

export interface SearchResult {
  card_id: string;
  node_id: string | null;
  title: string;
  card_type: CardType;
  is_symlink: boolean;
  snippet: string;
}
