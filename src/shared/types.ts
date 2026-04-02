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
  created_by: string | null;
  updated_by: string | null;
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

// ---------------------------------------------------------------------------
// Batch write types
// ---------------------------------------------------------------------------

export interface BatchCreateItem {
  /** Caller-assigned temporary ID for cross-referencing within the same batch. */
  temp_id: string;
  card_type: CardType;
  title: string;
  content?: string | null;
  tags?: string[];
  references?: string[];
  content_timestamp?: string | null;
  source_type?: string | null;
  source_ref?: string | null;
  /** Real node UUID — use this OR parent_temp_id, not both. */
  parent_node_id?: string | null;
  /** temp_id of another create in this batch to use as parent. */
  parent_temp_id?: string;
  position?: number;
}

export interface BatchUpdateItem {
  card_id: string;
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
  /** Optimistic locking: if set, update will fail (409) when current version differs. */
  expected_version?: number;
}

export interface BatchMoveItem {
  node_id: string;
  /** Real node UUID — use this OR parent_temp_id, not both. */
  new_parent_node_id?: string | null;
  /** temp_id of a create in this batch to use as the new parent. */
  parent_temp_id?: string;
  new_position?: number;
}

export interface BatchDeleteItem {
  card_id: string;
}

export interface BatchWriteInput {
  creates?: BatchCreateItem[];
  updates?: BatchUpdateItem[];
  moves?: BatchMoveItem[];
  deletes?: BatchDeleteItem[];
}

export interface BatchCreatedItem {
  temp_id: string;
  card_id: string;
  node_id: string;
}

export interface BatchWriteResult {
  created: BatchCreatedItem[];
  updated: string[];
  moved: string[];
  deleted: string[];
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type AtomEvent =
  | { type: 'card:created'; cardId: string; nodeId: string; parentNodeId: string | null; data: Card; actor: string | null }
  | { type: 'card:updated'; cardId: string; data: Card; actor: string | null }
  | { type: 'card:deleted'; cardId: string; actor: string | null }
  | { type: 'node:created'; nodeId: string; cardId: string; parentNodeId: string | null }
  | { type: 'node:deleted'; nodeId: string }
  | { type: 'node:moved'; nodeId: string; newParentNodeId: string | null }
  | { type: 'batch:completed'; result: BatchWriteResult };

// ---------------------------------------------------------------------------
// Fastify request augmentation
// ---------------------------------------------------------------------------

export type UserRole = 'admin' | 'editor' | 'viewer';

declare module 'fastify' {
  interface FastifyRequest {
    jwtUser?: {
      id: string;
      email: string;
      name: string;
      role: UserRole;
    };
  }
}
