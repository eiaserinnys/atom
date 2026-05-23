import { request } from './request';
import type { SearchResult } from './types';

export const searchApi = {
  search(q: string): Promise<SearchResult[]> {
    return request(`/search?q=${encodeURIComponent(q)}`);
  },
};
