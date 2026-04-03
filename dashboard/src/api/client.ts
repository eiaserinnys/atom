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

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export interface TreeNodeData {
  id: string;
  card_id: string;
  parent_node_id: string | null;
  position: number;
  is_symlink: boolean;
  created_at: string;
  card: CardData;
  children?: TreeNodeData[];
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
}

export interface SearchResult {
  card_id: string;
  node_id: string;
  title: string;
  card_type: 'structure' | 'knowledge';
  is_symlink: boolean;
  snippet: string;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
  });
  if (res.status === 401) {
    window.location.href = '/';
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

export const api = {
  getTree(): Promise<TreeNodeData[]> {
    return request('/tree');
  },

  getNode(nodeId: string): Promise<TreeNodeData> {
    return request(`/tree/${nodeId}`);
  },

  compile(nodeId: string): Promise<{ markdown: string }> {
    return request(`/tree/${nodeId}/compile`);
  },

  search(q: string): Promise<SearchResult[]> {
    return request(`/search?q=${encodeURIComponent(q)}`);
  },

  getCard(cardId: string): Promise<CardData> {
    return request(`/cards/${cardId}`);
  },

  updateCard(cardId: string, data: { title?: string; content?: string }): Promise<CardData> {
    return request(`/cards/${cardId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  listChildren(nodeId: string): Promise<TreeNodeData[]> {
    return request(`/tree/${nodeId}/children`);
  },

  getAuthStatus(): Promise<{ authenticated: boolean; id?: string; email?: string; name?: string; role?: UserRole }> {
    return request('/api/auth/status');
  },

  logout(): Promise<{ ok: boolean }> {
    return request('/api/auth/logout', { method: 'POST' });
  },
};

export const configApi = {
  // 사용자 관리 (admin only)
  listUsers(): Promise<User[]> {
    return request('/api/config/users');
  },
  addUser(body: { email: string; display_name?: string; role: UserRole }): Promise<User> {
    return request('/api/config/users', { method: 'POST', body: JSON.stringify(body) });
  },
  updateUser(id: string, body: { role?: UserRole; is_active?: boolean }): Promise<User> {
    return request(`/api/config/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  },
  // 에이전트 관리 (admin or editor)
  listAgents(): Promise<Agent[]> {
    return request('/api/config/agents');
  },
  createAgent(body: { agent_id: string; display_name?: string }): Promise<Agent & { secret?: string }> {
    return request('/api/config/agents', { method: 'POST', body: JSON.stringify(body) });
  },
  reissueSecret(id: string): Promise<{ secret: string }> {
    return request(`/api/config/agents/${id}/reissue`, { method: 'POST' });
  },
  updateAgent(id: string, body: { is_active: boolean }): Promise<Agent> {
    return request(`/api/config/agents/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  },
};
