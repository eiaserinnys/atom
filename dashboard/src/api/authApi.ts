import { request } from './request';
import type { AuthStatus } from './types';

export const authApi = {
  getAuthStatus(): Promise<AuthStatus> {
    return request('/api/auth/status');
  },

  logout(): Promise<{ ok: boolean }> {
    return request('/api/auth/logout', { method: 'POST' });
  },
};
