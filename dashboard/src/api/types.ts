export type UserRole = 'admin' | 'editor' | 'viewer';

export interface User {
  id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

export interface Agent {
  id: string;
  agent_id: string;
  display_name: string | null;
  is_active: boolean;
  created_at: string;
}

export interface TreeNodeData {
  id: string;
  card_id: string;
  parent_node_id: string | null;
  position: number;
  is_symlink: boolean;
  created_at: string;
  journal_limit: number | null;
  card: CardData;
  children?: TreeNodeData[];
  canonical_path?: string;
}

export interface CardData {
  id: string;
  card_type: 'structure' | 'knowledge';
  title: string;
  content: string | null;
  references: string[];
  tags: string[];
  card_timestamp: string;
  content_timestamp: string | null;
  source_type: string | null;
  source_ref: string | null;
  staleness: string;
  version: number;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface CredentialField {
  key: string;
  label: string;
  hint?: string;
  secret: boolean;
}

export interface AdapterInfo {
  sourceType: string;
  credentialFields: CredentialField[];
}

export interface UnfurlEntry {
  ok: boolean;
  data?: Record<string, unknown> | null;
  error?: string;
  sourceType: string;
}

export interface SearchResult {
  card_id: string;
  node_id: string | null;
  title: string;
  card_type: 'structure' | 'knowledge';
  is_symlink: boolean;
  snippet: string;
  node_path: string[];
}

export interface SearchFilters {
  limit?: number;
  rootNodeId?: string;
  tags?: string[];
  card_type?: 'structure' | 'knowledge';
  updated_after?: string;
  updated_before?: string;
  source_type?: string;
  strategy?: 'auto' | 'strict';
}

export interface MoveNodePayload {
  parent_node_id?: string | null;
  position?: number;
  before?: string;
  after?: string;
  to?: 'start' | 'end';
}

export interface CompileOptions {
  depth?: number;
  include_ids?: boolean;
  titles_only?: boolean;
  numbering?: boolean;
  max_chars?: number;
  exclude_nodes?: string[];
}

export interface AuthStatus {
  authenticated: boolean;
  id?: string;
  email?: string;
  name?: string;
  role?: UserRole;
}
