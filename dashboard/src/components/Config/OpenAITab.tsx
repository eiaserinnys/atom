import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { configApi } from '../../api/client';
import type { OpenAIConfigResponse } from '../../../../src/shared/embeddings';
import { ConfigActionButton, ConfigField } from './ConfigFields';

const POLL_INTERVAL_MS = 5000;

export function OpenAITab() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<OpenAIConfigResponse | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<'saved' | 'deleted' | null>(null);
  const mounted = useRef(false);
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    const operation = (async () => {
      try {
        const value = await configApi.getOpenAIConfig();
        if (mounted.current) {
          setStatus(value);
          setLoadFailed(false);
        }
      } catch {
        if (mounted.current) setLoadFailed(true);
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
    inFlight.current = operation;
    try {
      await operation;
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

  const refreshAfterMutation = async () => {
    if (inFlight.current) await inFlight.current;
    await refresh();
  };

  const handleSave = async () => {
    setSaving(true);
    setFailed(false);
    setNotice(null);
    try {
      await configApi.putOpenAIKey(draft);
      setDraft('');
      setNotice('saved');
      await refreshAfterMutation();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    setFailed(false);
    setNotice(null);
    try {
      await configApi.deleteOpenAIKey();
      setDraft('');
      setNotice('deleted');
      await refreshAfterMutation();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const pauseKey = status?.embedding.paused_reason
    ? `openai.paused_${status.embedding.paused_reason}`
    : status?.embedding.running ? 'openai.running' : 'openai.idle';
  const errorKey = status?.embedding.last_error
    ? `openai.error_${status.embedding.last_error.kind}`
    : null;

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold text-foreground mb-3">{t('config.tab_openai')}</h3>
        <div className="mb-3 text-sm text-foreground">
          {status
            ? status.key.configured ? t('openai.configured') : t('openai.not_configured')
            : loading ? t('common.loading') : loadFailed ? t('openai.load_failed') : null}
        </div>
        {status?.key.last_saved_at && (
          <div className="mb-3 text-[13px] text-muted-foreground">
            {t('openai.saved_at')}: {new Date(status.key.last_saved_at).toLocaleString()}
          </div>
        )}
        <ConfigField
          label={t('openai.key')}
          type="password"
          value={draft}
          disabled={saving}
          onChange={setDraft}
        />
        <div className="flex gap-2">
          <ConfigActionButton onClick={handleSave} disabled={saving || draft.trim().length === 0}>
            {saving ? t('common.loading') : t('common.save')}
          </ConfigActionButton>
          {status?.key.configured && (
            <ConfigActionButton tone="danger" onClick={handleDelete} disabled={saving}>
              {t('common.delete')}
            </ConfigActionButton>
          )}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-foreground mb-3">{t('openai.embeddings')}</h3>
        <div className="mb-3 text-sm text-foreground">{status?.embedding.model ?? 'text-embedding-3-large'}</div>
        {status && <div className="mb-3 text-sm text-foreground">
          {t('openai.progress', {
            completed: status.embedding.completed_cards.toLocaleString(),
            total: status.embedding.target_cards.toLocaleString(),
          })}
        </div>}
        {status && <div className="mb-3 text-sm text-muted-foreground">{t(pauseKey)}</div>}
        {errorKey && <div className="text-sm text-node-error">{t(errorKey)}</div>}
      </section>

      {failed && <div className="text-sm text-node-error">{t('openai.request_failed')}</div>}
      {notice && <div className="text-sm text-muted-foreground">{t(`openai.${notice}`)}</div>}
    </div>
  );
}
