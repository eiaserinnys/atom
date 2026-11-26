import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, configApi } from '../../api/client';
import { describeApiError } from '../../api/apiError';
import { useSystem } from '../../contexts/systemContext';
import { AdminPasswordSection } from './AdminPasswordSection';
import { ConfigField } from './ConfigFields';

const ENV_KEYS = {
  google: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL'] as const,
  slack: ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET', 'SLACK_CALLBACK_URL', 'SLACK_ALLOWED_TEAM_ID'] as const,
  admin: ['ALLOWED_EMAIL'] as const,
};

const SENSITIVE = new Set(['GOOGLE_CLIENT_SECRET', 'SLACK_CLIENT_SECRET']);
const AUTH_ENV_KEYS = [...ENV_KEYS.google, ...ENV_KEYS.slack, ...ENV_KEYS.admin];

function changedKeys(values: Record<string, string>, initialValues: Record<string, string>): string[] {
  return AUTH_ENV_KEYS.filter((key) => (values[key] ?? '') !== (initialValues[key] ?? ''));
}

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
  const [passwordMode, setPasswordMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const valuesRef = useRef(values);
  const initialValuesRef = useRef(initialValues);
  const translateRef = useRef(t);
  valuesRef.current = values;
  initialValuesRef.current = initialValues;
  translateRef.current = t;

  useEffect(() => {
    Promise.all([
      configApi.getEnv(),
      api.getAuthProviders().then((providers) => providers.password === true, () => false),
    ])
      .then(([loadedValues, isPasswordMode]) => {
        setValues(loadedValues);
        setInitialValues(loadedValues);
        setPasswordMode(isPasswordMode);
      })
      .catch((err) => setMessage({ ok: false, text: describeApiError(err, translateRef.current) }))
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setMessage(null);
  };

  const handleSave = useCallback(async () => {
    const currentValues = valuesRef.current;
    const entries = changedKeys(currentValues, initialValuesRef.current)
      .map((key) => ({ key, value: currentValues[key] ?? '' }));
    setSaving(true);
    setMessage(null);
    try {
      await configApi.putEnv(entries);
      setInitialValues(currentValues);
      setMessage({ ok: true, text: translateRef.current('auth.save_success') });
      refreshStatus();
    } catch (err) {
      setMessage({ ok: false, text: describeApiError(err, translateRef.current) });
    } finally {
      setSaving(false);
    }
  }, [refreshStatus]);

  const isDirty = changedKeys(values, initialValues).length > 0;

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
      {passwordMode && <AdminPasswordSection />}

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
