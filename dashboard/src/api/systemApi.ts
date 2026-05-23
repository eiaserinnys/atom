import { request } from './request';

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
