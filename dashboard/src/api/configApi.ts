import { request } from './request';
import type { Agent, User, UserRole } from './types';

export const configApi = {
  listUsers(): Promise<User[]> {
    return request('/api/config/users');
  },

  addUser(body: { email: string; display_name?: string; role: UserRole }): Promise<User> {
    return request('/api/config/users', { method: 'POST', body: JSON.stringify(body) });
  },

  updateUser(id: string, body: { role?: UserRole; is_active?: boolean }): Promise<User> {
    return request(`/api/config/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  },

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
    return request('/api/config/db-test', {
      method: 'POST',
      body: JSON.stringify({ connectionString }),
    });
  },

  getDbInfo(): Promise<{
    dbType: string;
    sqliteFile: string;
    sqliteFileExists: boolean;
    deprecatedFileExists: boolean;
  }> {
    return request('/api/config/db-info');
  },
};
