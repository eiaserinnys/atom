import type { CardData, TreeNodeData } from '../api/client';

export function makeCard(id: string, title: string): CardData {
  return {
    id,
    card_type: 'knowledge',
    title,
    content: null,
    references: [],
    tags: [],
    card_timestamp: '2026-01-01T00:00:00Z',
    content_timestamp: null,
    source_type: null,
    source_ref: null,
    staleness: 'unverified',
    version: 1,
    updated_at: '2026-01-01T00:00:00Z',
    created_by: null,
    updated_by: null,
  };
}

export function makeNode(
  id: string,
  cardId: string,
  parentNodeId: string | null = null,
  position = 100,
  children?: TreeNodeData[]
): TreeNodeData {
  return {
    id,
    card_id: cardId,
    parent_node_id: parentNodeId,
    position,
    is_symlink: false,
    journal_limit: null,
    created_at: '2026-01-01T00:00:00Z',
    card: makeCard(cardId, `Card ${cardId}`),
    ...(children !== undefined ? { children } : {}),
  };
}
