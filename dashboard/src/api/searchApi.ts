import { request } from './request';
import type { SearchFilters, SearchResult } from './types';

export const searchApi = {
  search(q: string, filters: SearchFilters = {}): Promise<SearchResult[]> {
    const params = new URLSearchParams();
    params.set('q', q);

    if (filters.limit !== undefined) params.set('limit', String(filters.limit));
    if (filters.rootNodeId) params.set('rootNodeId', filters.rootNodeId);
    if (filters.tags?.length) params.set('tags', filters.tags.join(','));
    if (filters.card_type) params.set('card_type', filters.card_type);
    if (filters.updated_after) params.set('updated_after', filters.updated_after);
    if (filters.updated_before) params.set('updated_before', filters.updated_before);
    if (filters.source_type) params.set('source_type', filters.source_type);
    if (filters.strategy) params.set('strategy', filters.strategy);

    return request(`/search?${params.toString()}`);
  },
};
