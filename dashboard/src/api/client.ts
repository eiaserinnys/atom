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
  node_id: string;
  title: string;
  card_type: 'structure' | 'knowledge';
  is_symlink: boolean;
  snippet: string;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options?.body != null ? { 'Content-Type': 'application/json' } : {}),
      ...options?.headers,
    },
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

async function requestVoid(path: string, options?: RequestInit): Promise<void> {
  // body가 없는 DELETE 요청에 Content-Type: application/json을 보내면
  // Fastify가 400을 반환하므로 body가 있을 때만 헤더를 전송한다.
  const res = await fetch(`${BASE_URL}${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options?.body != null ? { 'Content-Type': 'application/json' } : {}),
      ...options?.headers,
    },
  });
  if (res.status === 401) {
    window.location.href = '/';
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
}

export const api = {
  getTree(): Promise<TreeNodeData[]> {
    return request('/tree');
  },

  getNode(nodeId: string): Promise<TreeNodeData> {
    return request(`/tree/${nodeId}`);
  },

  compile(nodeId: string, options?: {
    depth?: number;
    include_ids?: boolean;
    titles_only?: boolean;
    numbering?: boolean;
    max_chars?: number;
    exclude_nodes?: string[];
  }): Promise<{ markdown: string }> {
    const params = new URLSearchParams();
    if (options?.depth === Infinity) {
      params.set("depth", "Infinity");
    } else if (options?.depth !== undefined) {
      params.set("depth", String(options.depth));
    }
    if (options?.include_ids) params.set("include_ids", "true");
    if (options?.titles_only) params.set("titles_only", "true");
    if (options?.numbering) params.set("numbering", "true");
    if (options?.max_chars !== undefined) params.set("max_chars", String(options.max_chars));
    if (options?.exclude_nodes?.length) params.set("exclude_nodes", options.exclude_nodes.join(","));
    const qs = params.toString();
    return request(`/tree/${nodeId}/compile${qs ? `?${qs}` : ""}`);
  },

  getAdapters(): Promise<{ adapters: AdapterInfo[] }> {
    return request('/api/unfurl/adapters');
  },

  compileWithRefs(
    nodeId: string,
    depth: number,
    resolveRefs: 'cached' | 'fresh',
    credentials: Record<string, Record<string, string>>
  ): Promise<{ markdown: string; unfurls?: Record<string, UnfurlEntry> }> {
    return request(`/tree/${nodeId}/compile`, {
      method: 'POST',
      body: JSON.stringify({ depth: depth === Infinity ? null : depth, resolveRefs, credentials }),
    });
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

  // 서버 응답: { ...card, node_id } — uuid 필드명은 `id` (card_id 아님)
  createCard(data: {
    card_type: 'structure' | 'knowledge';
    title: string;
    content?: string;
    parent_node_id?: string | null;
    position?: number;
  }): Promise<CardData & { node_id: string }> {
    return request('/cards', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // DELETE /tree/:nodeId → 204 No Content
  deleteNode(nodeId: string): Promise<void> {
    return requestVoid(`/tree/${nodeId}`, { method: 'DELETE' });
  },

  // PUT /tree/:nodeId/move → 204 No Content
  moveNode(nodeId: string, data: { parent_node_id: string | null; position?: number }): Promise<void> {
    return requestVoid(`/tree/${nodeId}/move`, {
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
  getEnv(): Promise<Record<string, string>> {
    return request('/api/config/env');
  },
  putEnv(entries: { key: string; value: string }[]): Promise<{ ok: boolean }> {
    return request('/api/config/env', { method: 'PUT', body: JSON.stringify(entries) });
  },
  testDbConnection(connectionString: string): Promise<{ ok: boolean; error?: string }> {
    return request('/api/config/db-test', { method: 'POST', body: JSON.stringify({ connectionString }) });
  },
  getDbInfo(): Promise<{ dbType: string; sqliteFile: string; sqliteFileExists: boolean; deprecatedFileExists: boolean }> {
    return request('/api/config/db-info');
  },
};

export const systemApi = {
  getHealth(): Promise<{ status: string }> {
    return request('/api/health');
  },
  getStatus(): Promise<{ pendingRestart: boolean }> {
    return request('/api/system/status');
  },
  restart(): Promise<{ ok: boolean }> {
    return request('/api/system/restart', { method: 'POST' });
  },
};
