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
  journal_limit: number | null;
}

export interface TreeNodeWithCard extends TreeNode {
  card: Card;
  canonical_path?: string;
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
  staleness?: Staleness;
}

export interface SearchResult {
  card_id: string;
  node_id: string | null;
  title: string;
  card_type: CardType;
  is_symlink: boolean;
  snippet: string;
  node_path: string[];  // 조상 타이틀 배열 (루트 → 부모 순서). 고아 카드이면 []
}

// ---------------------------------------------------------------------------
// Batch operation types
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

export interface BatchSymlinkItem {
  /** Card ID to create a symlink for. */
  card_id: string;
  /** Real node UUID — use this OR parent_temp_id, not both. */
  parent_node_id?: string | null;
  /** temp_id of a create in this batch to use as parent. */
  parent_temp_id?: string;
  /** Position among siblings. */
  position?: number;
}

/**
 * Tree node property update (batch_op.node_updates).
 * node_id must reference a pre-existing node — temp_id is not supported here.
 */
export interface BatchNodeUpdateItem {
  /** Real node UUID to update. */
  node_id: string;
  /** Per-node children limit. null = no limit; 0 = unlimited; N = latest N. Omit to leave unchanged. */
  journal_limit?: number | null;
}

export interface BatchOpInput {
  creates?: BatchCreateItem[];
  symlinks?: BatchSymlinkItem[];
  updates?: BatchUpdateItem[];
  node_updates?: BatchNodeUpdateItem[];
  moves?: BatchMoveItem[];
  deletes?: BatchDeleteItem[];
}

export interface BatchCreatedItem {
  temp_id: string;
  card_id: string;
  node_id: string;
}

export interface BatchOpResult {
  created: BatchCreatedItem[];
  symlinked: string[];
  updated: string[];
  /**
   * Note: named `node_updated` (not `updates` past tense) because `updated` above
   * already holds card-update results. This field records tree_node property updates
   * performed by the `node_updates` block. The name makes the card/node distinction
   * explicit rather than following the one-word past-tense pattern of siblings.
   */
  node_updated: string[];
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
  | { type: 'node:updated'; nodeId: string }
  | { type: 'node:deleted'; nodeId: string }
  | { type: 'node:moved'; nodeId: string; newParentNodeId: string | null }
  | { type: 'batch:completed'; result: BatchOpResult };

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
