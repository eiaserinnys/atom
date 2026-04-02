import { useState, useEffect } from 'react';
import { useConfig } from '../../hooks/useConfig';

export function AgentManagementTab() {
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
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [reissueErrors, setReissueErrors] = useState<Record<string, string>>({});
  const [updateErrors, setUpdateErrors] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const handleCreate = async () => {
    if (!newAgentId.trim()) {
      setCreateError('agent_id를 입력하세요.');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await createAgent({
        agent_id: newAgentId.trim(),
        display_name: newDisplayName.trim() || undefined,
      });
      setNewAgentId('');
      setNewDisplayName('');
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

  const handleToggleActive = async (id: string, is_active: boolean) => {
    setUpdateErrors((prev) => ({ ...prev, [id]: '' }));
    try {
      await updateAgent(id, { is_active });
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
      // clipboard API 실패 시 무시
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* 시크릿 1회 표시 배너 */}
      {lastCreatedSecret && (
        <div className="flex flex-col gap-2 bg-node-plan/10 border border-node-plan/40 rounded-md px-3 py-3">
          <div className="text-xs font-semibold text-node-plan">
            API 시크릿 — 지금만 표시됩니다. 안전한 곳에 저장하세요.
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-card border border-border rounded px-2 py-1.5 font-mono text-foreground break-all">
              {lastCreatedSecret}
            </code>
            <button
              className="text-xs rounded px-2.5 py-1 border border-node-plan/60 bg-transparent text-node-plan cursor-pointer hover:bg-node-plan/10 font-sans whitespace-nowrap"
              onClick={handleCopy}
            >
              {copied ? '복사됨' : '복사'}
            </button>
          </div>
          <button
            className="self-start text-xs rounded px-2.5 py-1 border border-border bg-transparent text-muted-foreground cursor-pointer hover:bg-muted font-sans"
            onClick={clearSecret}
          >
            확인했습니다
          </button>
        </div>
      )}

      {/* 새 에이전트 생성 */}
      <div className="flex flex-col gap-2">
        <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          에이전트 생성
        </div>
        <div className="flex flex-col gap-2">
          <input
            className="w-full bg-card border border-border rounded px-2.5 py-1.5 text-foreground text-sm outline-none focus:border-node-user font-sans"
            placeholder="agent_id (예: my-agent)"
            value={newAgentId}
            onChange={(e) => setNewAgentId(e.target.value)}
          />
          <input
            className="w-full bg-card border border-border rounded px-2.5 py-1.5 text-foreground text-sm outline-none focus:border-node-user font-sans"
            placeholder="표시 이름 (선택)"
            value={newDisplayName}
            onChange={(e) => setNewDisplayName(e.target.value)}
          />
          <button
            className="self-start bg-node-user text-white border-none rounded px-3 py-1.5 text-sm cursor-pointer font-sans disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleCreate}
            disabled={creating}
          >
            {creating ? '생성 중...' : '생성'}
          </button>
          {createError && (
            <div className="text-node-error text-xs">{createError}</div>
          )}
        </div>
      </div>

      {/* 에이전트 목록 */}
      <div className="flex flex-col gap-2">
        <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          에이전트 목록
        </div>
        {loading && <div className="text-muted-foreground text-sm">로딩 중...</div>}
        {!loading && agents.length === 0 && (
          <div className="text-muted-foreground text-sm">등록된 에이전트가 없습니다.</div>
        )}
        <div className="flex flex-col gap-2">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="flex flex-col gap-1 bg-card border border-border rounded px-3 py-2"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <code className="text-sm text-foreground font-mono flex-1 min-w-0 truncate">
                  {agent.agent_id}
                </code>
                {agent.display_name && (
                  <span className="text-xs text-muted-foreground">{agent.display_name}</span>
                )}
                <span
                  className={`text-xs rounded px-1.5 py-px border ${
                    agent.is_active
                      ? 'text-node-response border-node-response/40 bg-node-response/10'
                      : 'text-muted-foreground border-border bg-muted'
                  }`}
                >
                  {agent.is_active ? '활성' : '비활성'}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  className="text-xs rounded px-2 py-0.5 border border-border bg-transparent text-muted-foreground cursor-pointer hover:bg-muted font-sans"
                  onClick={() => handleReissue(agent.id)}
                >
                  시크릿 재발급
                </button>
                <button
                  className="text-xs rounded px-2 py-0.5 border border-border bg-transparent text-muted-foreground cursor-pointer hover:bg-muted font-sans"
                  onClick={() => handleToggleActive(agent.id, !agent.is_active)}
                >
                  {agent.is_active ? '비활성화' : '활성화'}
                </button>
              </div>
              {reissueErrors[agent.id] && (
                <div className="text-node-error text-xs">{reissueErrors[agent.id]}</div>
              )}
              {updateErrors[agent.id] && (
                <div className="text-node-error text-xs">{updateErrors[agent.id]}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
