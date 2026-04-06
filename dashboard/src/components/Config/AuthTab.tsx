import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { configApi } from '../../api/client';
import { useSystem } from '../../contexts/SystemContext';

const ENV_KEYS = {
  google: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL'] as const,
  slack: ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET', 'SLACK_CALLBACK_URL', 'SLACK_ALLOWED_TEAM_ID'] as const,
  admin: ['ALLOWED_EMAIL'] as const,
};

const SENSITIVE = new Set(['GOOGLE_CLIENT_SECRET', 'SLACK_CLIENT_SECRET']);

export function AuthTab() {
  const { t } = useTranslation();
  const { pendingRestart } = useSystem();
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    configApi.getEnv()
      .then(setValues)
      .catch((err) => setMessage({ ok: false, text: err.message }))
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const entries = [
        ...ENV_KEYS.google.map((k) => ({ key: k, value: values[k] ?? '' })),
        ...ENV_KEYS.slack.map((k) => ({ key: k, value: values[k] ?? '' })),
        ...ENV_KEYS.admin.map((k) => ({ key: k, value: values[k] ?? '' })),
      ];
      await configApi.putEnv(entries);
      setMessage({ ok: true, text: t('auth.save_success') });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-muted-foreground">{t('common.loading')}</div>;

  const renderField = (key: string, label: string) => {
    const isSensitive = SENSITIVE.has(key);
    const val = values[key] ?? '';
    const isMasked = isSensitive && val === '***';
    return (
      <div key={key} className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">{label}</label>
        <input
          type={isSensitive ? 'password' : 'text'}
          className="w-full px-3 py-1.5 text-sm rounded border border-border bg-background text-foreground"
          placeholder={isMasked ? t('auth.secret_set') : isSensitive ? t('auth.secret_not_set') : ''}
          value={isMasked ? '' : val}
          onChange={(e) => handleChange(key, e.target.value)}
          disabled={pendingRestart}
        />
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold text-foreground mb-3">{t('auth.google_section')}</h3>
        {renderField('GOOGLE_CLIENT_ID', t('auth.client_id'))}
        {renderField('GOOGLE_CLIENT_SECRET', t('auth.client_secret'))}
        {renderField('GOOGLE_CALLBACK_URL', t('auth.callback_url'))}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-foreground mb-3">{t('auth.slack_section')}</h3>
        {renderField('SLACK_CLIENT_ID', t('auth.client_id'))}
        {renderField('SLACK_CLIENT_SECRET', t('auth.client_secret'))}
        {renderField('SLACK_CALLBACK_URL', t('auth.callback_url'))}
        {renderField('SLACK_ALLOWED_TEAM_ID', t('auth.allowed_team_id'))}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-foreground mb-3">{t('auth.allowed_email')}</h3>
        {renderField('ALLOWED_EMAIL', t('auth.allowed_email'))}
      </section>

      {message && (
        <div className={`text-sm ${message.ok ? 'text-green-400' : 'text-red-400'}`}>
          {message.text}
        </div>
      )}

      <button
        className="px-4 py-2 text-sm font-medium rounded bg-node-user text-white hover:opacity-90 disabled:opacity-50"
        onClick={handleSave}
        disabled={saving || pendingRestart}
      >
        {saving ? t('common.loading') : t('auth.save')}
      </button>
    </div>
  );
}
