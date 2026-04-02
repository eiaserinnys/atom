import { useState, useCallback } from 'react';
import { configApi, type User, type Agent, type UserRole } from '../api/client';

export function useConfig() {
  const [users, setUsers] = useState<User[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastCreatedSecret, setLastCreatedSecret] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await configApi.listUsers();
      setUsers(data);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    try {
      const data = await configApi.listAgents();
      setAgents(data);
    } finally {
      setLoading(false);
    }
  }, []);

  const addUser = useCallback(
    async (input: { email: string; display_name?: string; role: UserRole }) => {
      await configApi.addUser(input);
      await loadUsers();
    },
    [loadUsers]
  );

  // API 에러(400 last admin 등)는 throw되어 컴포넌트로 전파됨
  // 컴포넌트에서 catch하여 인라인 에러 메시지로 표시한다
  const updateUser = useCallback(
    async (id: string, body: { role?: UserRole; is_active?: boolean }) => {
      await configApi.updateUser(id, body);
      await loadUsers();
    },
    [loadUsers]
  );

  const createAgent = useCallback(
    async (input: { agent_id: string; display_name?: string }) => {
      const result = await configApi.createAgent(input);
      setLastCreatedSecret(result.secret ?? null);
      await loadAgents();
    },
    [loadAgents]
  );

  const reissueSecret = useCallback(async (id: string) => {
    const result = await configApi.reissueSecret(id);
    setLastCreatedSecret(result.secret ?? null);
  }, []);

  const updateAgent = useCallback(
    async (id: string, body: { is_active: boolean }) => {
      await configApi.updateAgent(id, body);
      await loadAgents();
    },
    [loadAgents]
  );

  const clearSecret = useCallback(() => setLastCreatedSecret(null), []);

  return {
    users,
    agents,
    loading,
    lastCreatedSecret,
    clearSecret,
    loadUsers,
    loadAgents,
    addUser,
    updateUser,
    createAgent,
    reissueSecret,
    updateAgent,
  };
}
