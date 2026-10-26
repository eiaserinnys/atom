import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { configApi } from '../../api/client';
import type { OpenAIConfigResponse } from '../../../../src/shared/embeddings';
import { ConfigActionButton, ConfigField } from './ConfigFields';

const POLL_INTERVAL_MS = 5000;

type Action = 'save' | 'delete' | null;

export function OpenAITab() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<OpenAIConfigResponse | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pendingAction, setPendingAction] = useState<Action>(null);
  const [requestFailed, setRequestFailed] = useState(false);
  const [notice, setNotice] = useState<'saved' | 'deleted' | null>(null);
  const mounted = useRef(false);
  const inFlight = useRef<Promise<boolean> | null>(null);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;
    const operation = (async () => {
      try {
        const value = await configApi.getOpenAIConfig();
        if (mounted.current) {
          setStatus(value);
          setLoadFailed(false);
        }
        return true;
      } catch {
        if (mounted.current) setLoadFailed(true);
        return false;
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
    inFlight.current = operation;
    try {
      return await operation;
    } finally {
      if (inFlight.current === operation) inFlight.current = null;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, POLL_INTERVAL_MS);
    return () => {
      mounted.current = false;
      window.clearInterval(interval);
    };
  }, [refresh]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 2000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const refreshAfterMutation = async (): Promise<boolean> => {
    if (inFlight.current) await inFlight.current;
    return refresh();
  };

  const handleSave = async () => {
    setPendingAction('save');
    setRequestFailed(false);
    setNotice(null);
    try {
      await configApi.putOpenAIKey(draft);
      setDraft('');
      if (await refreshAfterMutation()) setNotice('saved');
    } catch {
      setRequestFailed(true);
    } finally {
      setPendingAction(null);
    }
  };

  const handleDelete = async () => {
    setPendingAction('delete');
    setRequestFailed(false);
    setNotice(null);
    try {
      await configApi.deleteOpenAIKey();
      setDraft('');
      if (await refreshAfterMutation()) setNotice('deleted');
    } catch {
      setRequestFailed(true);
    } finally {
      setPendingAction(null);
    }
  };

  const embedding = status?.embedding;
  const complete = embedding !== undefined
    && embedding.completed_cards >= embedding.target_cards
    && !embedding.last_error;
  const pauseKey = embedding
    ? complete ? null : embedding.paused_reason
      ? `openai.paused_${embedding.paused_reason}`
      : embedding.running ? 'openai.running' : 'openai.idle'
    : null;
  const duplicateError = embedding?.paused_reason === 'auth'
      && embedding.last_error?.kind === 'OPENAI_AUTH'
    || embedding?.paused_reason === 'rate_limited'
      && embedding.last_error?.kind === 'OPENAI_RATE_LIMIT';
  const errorKey = embedding?.last_error && !duplicateError
    ? `openai.error_${embedding.last_error.kind}`
    : null;
  const progress = embedding
    ? embedding.target_cards > 0
      ? Math.min(100, embedding.completed_cards / embedding.target_cards * 100)
      : 100
    : 0;
  const actionMessageKey = pendingAction
    ? null
    : requestFailed
      ? 'openai.request_failed'
      : loadFailed
        ? 'openai.load_failed'
        : notice ? `openai.${notice}` : null;
  const actionMessageError = requestFailed || loadFailed;

  return (
    <div className="space-y-6">
      <section>
        <ConfigField
          label={t('openai.key')}
          type="password"
          placeholder={status ? t(status.key.configured ? 'openai.configured' : 'openai.not_configured') : ''}
          value={draft}
          disabled={pendingAction !== null}
          onChange={setDraft}
        />
        {status?.key.configured && status.key.last_saved_at && (
          <div className="mb-3 text-[13px] text-muted-foreground">
            {t('openai.saved_at')}: {new Date(status.key.last_saved_at).toLocaleString(i18n.language, {
              year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit',
            })}
          </div>
        )}
        <div className="flex items-center gap-2">
          <ConfigActionButton onClick={handleSave} disabled={pendingAction !== null || draft.trim().length === 0}>
            {pendingAction === 'save' ? t('common.loading') : t('common.save')}
          </ConfigActionButton>
          {status?.key.configured && (
            <ConfigActionButton tone="secondary" onClick={handleDelete} disabled={pendingAction !== null}>
              {pendingAction === 'delete' ? t('common.loading') : t('common.delete')}
            </ConfigActionButton>
          )}
          {actionMessageKey && (
            <span className={`text-sm ${actionMessageError ? 'text-node-error' : 'text-muted-foreground'}`} aria-live="polite">
              {t(actionMessageKey)}
            </span>
          )}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-foreground mb-3">{t('openai.embeddings')}</h3>
        <div className="mb-3 text-[13px] text-muted-foreground">{embedding?.model ?? 'text-embedding-3-large'}</div>
        {embedding && <div className="mb-3 flex items-center gap-2 text-sm">
          <div
            className="h-0.5 flex-1 overflow-hidden bg-muted"
            role="progressbar"
            aria-label={t('openai.embeddings')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
          >
            <div className="h-full bg-brand" style={{ width: `${progress}%` }} />
          </div>
          <span className="shrink-0">
            {t('openai.progress', {
              completed: embedding.completed_cards.toLocaleString(),
              total: embedding.target_cards.toLocaleString(),
            })}
          </span>
        </div>}
        {pauseKey && <div className="mb-3 text-sm text-muted-foreground">{t(pauseKey)}</div>}
        {errorKey && <div className="text-sm text-node-error">{t(errorKey)}</div>}
      </section>

      {loading && !status && <div className="text-sm text-muted-foreground">{t('common.loading')}</div>}
    </div>
  );
}
