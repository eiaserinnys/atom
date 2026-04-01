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
    ...options,
  });
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
};
