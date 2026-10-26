import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { configApi } from '../../api/client';
import { useSystem } from '../../contexts/systemContext';
import { ConfigField } from './ConfigFields';

const ENV_KEYS = {
  google: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL'] as const,
  slack: ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET', 'SLACK_CALLBACK_URL', 'SLACK_ALLOWED_TEAM_ID'] as const,
  admin: ['ALLOWED_EMAIL'] as const,
};

const SENSITIVE = new Set(['GOOGLE_CLIENT_SECRET', 'SLACK_CLIENT_SECRET']);

export interface AuthFooterState {
  disabled: boolean;
  saving: boolean;
  message: { ok: boolean; text: string } | null;
  onSave: () => Promise<void>;
}

interface Props {
  onFooterChange?: (state: AuthFooterState) => void;
}

export function AuthTab({ onFooterChange }: Props) {
  const { t } = useTranslation();
  const { pendingRestart, refreshStatus } = useSystem();
  const [values, setValues] = useState<Record<string, string>>({});
  const [initialValues, setInitialValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const valuesRef = useRef(values);
  const translateRef = useRef(t);
  valuesRef.current = values;
  translateRef.current = t;

  useEffect(() => {
    configApi.getEnv()
      .then((loadedValues) => {
        setValues(loadedValues);
        setInitialValues(loadedValues);
      })
      .catch((err) => setMessage({ ok: false, text: err.message }))
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setMessage(null);
  };

  const handleSave = useCallback(async () => {
    const currentValues = valuesRef.current;
    setSaving(true);
    setMessage(null);
    try {
      const entries = [
        ...ENV_KEYS.google.map((key) => ({ key, value: currentValues[key] ?? '' })),
        ...ENV_KEYS.slack.map((key) => ({ key, value: currentValues[key] ?? '' })),
        ...ENV_KEYS.admin.map((key) => ({ key, value: currentValues[key] ?? '' })),
      ];
      await configApi.putEnv(entries);
      setInitialValues(currentValues);
      setMessage({ ok: true, text: translateRef.current('auth.save_success') });
      refreshStatus();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }, [refreshStatus]);

  const isDirty = Object.keys(values).some((key) => values[key] !== initialValues[key]);

  useEffect(() => {
    onFooterChange?.({
      disabled: loading || saving || pendingRestart || !isDirty,
      saving,
      message,
      onSave: handleSave,
    });
  }, [handleSave, isDirty, loading, message, onFooterChange, pendingRestart, saving]);

  const renderField = (key: string, label: string) => {
    const isSensitive = SENSITIVE.has(key);
    const value = values[key] ?? '';
    const isMasked = isSensitive && value === '***';
    return (
      <ConfigField
        key={key}
        label={label}
        type={isSensitive ? 'password' : 'text'}
        placeholder={isMasked ? t('auth.secret_set') : isSensitive ? t('auth.secret_not_set') : ''}
        value={isMasked ? '' : value}
        onChange={(nextValue) => handleChange(key, nextValue)}
        disabled={pendingRestart}
      />
    );
  };

  if (loading) return <div className="text-muted-foreground">{t('common.loading')}</div>;

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-3 text-sm font-semibold text-foreground">{t('auth.google_section')}</h3>
        {renderField('GOOGLE_CLIENT_ID', t('auth.client_id'))}
        {renderField('GOOGLE_CLIENT_SECRET', t('auth.client_secret'))}
        {renderField('GOOGLE_CALLBACK_URL', t('auth.callback_url'))}
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-foreground">{t('auth.slack_section')}</h3>
        {renderField('SLACK_CLIENT_ID', t('auth.client_id'))}
        {renderField('SLACK_CLIENT_SECRET', t('auth.client_secret'))}
        {renderField('SLACK_CALLBACK_URL', t('auth.callback_url'))}
        {renderField('SLACK_ALLOWED_TEAM_ID', t('auth.allowed_team_id'))}
      </section>

      <section>
        {renderField('ALLOWED_EMAIL', t('auth.allowed_email'))}
      </section>
    </div>
  );
}
