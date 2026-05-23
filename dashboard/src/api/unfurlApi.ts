import { request } from './request';
import type { AdapterInfo } from './types';

export const unfurlApi = {
  getAdapters(): Promise<{ adapters: AdapterInfo[] }> {
    return request('/api/unfurl/adapters');
  },
};
