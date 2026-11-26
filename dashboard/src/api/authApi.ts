import { request } from './request';
import type { AuthStatus } from './types';

export const authApi = {
  getAuthStatus(): Promise<AuthStatus> {
    return request('/api/auth/status');
  },

  getProviders(): Promise<{ google: boolean; slack: boolean; password?: boolean }> {
    return request('/api/auth/providers');
  },

  logout(): Promise<{ ok: boolean }> {
    return request('/api/auth/logout', { method: 'POST' });
  },
};
