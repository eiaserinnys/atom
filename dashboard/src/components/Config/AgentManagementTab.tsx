import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfig } from '../../hooks/useConfig';
import type { AgentScope } from '../../api/client';
import type { UserRole } from '../../hooks/useAuth';
import { ConfigActionButton, ConfigField, CONFIG_CONTROL_CLASS } from './ConfigFields';

interface Props {
  currentUserRole: UserRole;
}

export function AgentManagementTab({ currentUserRole }: Props) {
  const { t } = useTranslation();
  const {
    agents,
    loading,
    lastCreatedSecret,
    clearSecret,
    loadAgents,
    createAgent,
    reissueSecret,
    updateAgent,
  } = useConfig();

  const [newAgentId, setNewAgentId] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newScope, setNewScope] = useState<AgentScope>('read');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [reissueErrors, setReissueErrors] = useState<Record<string, string>>({});
  const [updateErrors, setUpdateErrors] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const canManageAgents = currentUserRole === 'admin';

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const handleCreate = async () => {
    if (!newAgentId.trim()) {
      setCreateError(t('agents.agent_id_required'));
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await createAgent({
        agent_id: newAgentId.trim(),
        display_name: newDisplayName.trim() || undefined,
        scope: newScope,
      });
      setNewAgentId('');
      setNewDisplayName('');
      setNewScope('read');
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleReissue = async (id: string) => {
    setReissueErrors((prev) => ({ ...prev, [id]: '' }));
    try {
      await reissueSecret(id);
    } catch (e: unknown) {
      setReissueErrors((prev) => ({
        ...prev,
        [id]: e instanceof Error ? e.message : String(e),
      }));
    }
  };

  const handleUpdate = async (id: string, body: { is_active?: boolean; scope?: AgentScope }) => {
    setUpdateErrors((prev) => ({ ...prev, [id]: '' }));
    try {
      await updateAgent(id, body);
    } catch (e: unknown) {
      setUpdateErrors((prev) => ({
        ...prev,
        [id]: e instanceof Error ? e.message : String(e),
      }));
    }
  };

  const handleCopy = async () => {
    if (!lastCreatedSecret) return;
    try {
      await navigator.clipboard.writeText(lastCreatedSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The browser may not grant clipboard access.
    }
  };

  return (
    <div className="space-y-6">
      {canManageAgents && lastCreatedSecret && (
        <div className="flex flex-col gap-2 bg-brand/8 border border-brand/25 rounded-none px-3 py-3">
          <div className="text-[13px] font-semibold text-brand">
            {t('agents.new_key_warning')}
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[13px] bg-card border border-border rounded-none px-2 py-1.5 font-mono text-foreground break-all">
              {lastCreatedSecret}
            </code>
            <ConfigActionButton tone="secondary" onClick={handleCopy}>
              {copied ? t('common.copied') : t('common.copy')}
            </ConfigActionButton>
          </div>
          <div className="self-start">
            <ConfigActionButton tone="secondary" onClick={clearSecret}>
              {t('agents.acknowledged')}
            </ConfigActionButton>
          </div>
        </div>
      )}

      {canManageAgents && (
        <section>
          <h3 className="mb-3 text-sm font-semibold text-foreground">
            {t('agents.create_section')}
          </h3>
          <ConfigField
            label={t('agents.name_label')}
            placeholder={t('agents.name_placeholder')}
            value={newAgentId}
            onChange={setNewAgentId}
          />
          <ConfigField
            label={t('agents.display_name_label')}
            placeholder={t('agents.display_name_placeholder')}
            value={newDisplayName}
            onChange={setNewDisplayName}
          />
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col">
              <label htmlFor="new-agent-scope" className="mb-1 block text-[13px] text-muted-foreground">
                {t('agents.scope_label')}
              </label>
              <select
                id="new-agent-scope"
                aria-label={t('agents.scope_label')}
                className={`w-auto h-9 ${CONFIG_CONTROL_CLASS}`}
                value={newScope}
                onChange={(event) => setNewScope(event.target.value as AgentScope)}
              >
                <option value="read">{t('agents.scope_read')}</option>
                <option value="write">{t('agents.scope_write')}</option>
              </select>
            </div>
            <ConfigActionButton onClick={handleCreate} disabled={creating}>
              {creating ? t('agents.creating') : t('agents.generate_btn')}
            </ConfigActionButton>
          </div>
          {createError && (
            <div className="mt-2 text-node-error text-[13px]">{createError}</div>
          )}
        </section>
      )}

      <section>
        {canManageAgents && (
          <h3 className="mb-3 text-sm font-semibold text-foreground">
            {t('agents.list_section')}
          </h3>
        )}
        {loading && <div className="text-muted-foreground text-sm">{t('common.loading')}</div>}
        {!loading && agents.length === 0 && (
          <div className="text-muted-foreground text-sm">{t('agents.no_agents')}</div>
        )}
        <div className="flex flex-col gap-2">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="flex flex-col gap-1 bg-card border border-border rounded-none px-3 py-2"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <code className="text-sm text-foreground font-mono flex-1 min-w-0 truncate">
                  {agent.agent_id}
                </code>
                {agent.display_name && (
                  <span className="text-[13px] text-muted-foreground">{agent.display_name}</span>
                )}
                <span
                  className={`text-[13px] rounded-none px-1.5 py-px border ${
                    agent.is_active
                      ? 'text-node-response border-node-response/40 bg-node-response/10'
                      : 'text-muted-foreground border-border bg-muted'
                  }`}
                >
                  {agent.is_active ? t('agents.active') : t('agents.inactive')}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {canManageAgents ? (
                  <>
                    <select
                      id={`agent-scope-${agent.id}`}
                      aria-label={t('agents.scope_label')}
                      className={`w-auto h-9 ${CONFIG_CONTROL_CLASS}`}
                      value={agent.scope}
                      onChange={(event) => { void handleUpdate(agent.id, { scope: event.target.value as AgentScope }); }}
                    >
                      <option value="read">{t('agents.scope_read')}</option>
                      <option value="write">{t('agents.scope_write')}</option>
                    </select>
                    <ConfigActionButton tone="secondary" onClick={() => handleReissue(agent.id)}>
                      {t('agents.reissue')}
                    </ConfigActionButton>
                    <ConfigActionButton
                      tone="secondary"
                      onClick={() => { void handleUpdate(agent.id, { is_active: !agent.is_active }); }}
                    >
                      {agent.is_active ? t('agents.deactivate') : t('agents.activate')}
                    </ConfigActionButton>
                  </>
                ) : (
                  <span className="text-[13px] text-muted-foreground">
                    {agent.scope === 'read' ? t('agents.scope_read') : t('agents.scope_write')}
                  </span>
                )}
              </div>
              {canManageAgents && reissueErrors[agent.id] && (
                <div className="text-node-error text-[13px]">{reissueErrors[agent.id]}</div>
              )}
              {canManageAgents && updateErrors[agent.id] && (
                <div className="text-node-error text-[13px]">{updateErrors[agent.id]}</div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
