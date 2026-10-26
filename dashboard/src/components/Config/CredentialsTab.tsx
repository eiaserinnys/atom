import { useTranslation } from 'react-i18next';
import { useAdapters } from '../../hooks/useAdapters';
import { useLocalStorageCredentials } from '../../hooks/useLocalStorageCredentials';
import { ConfigField } from './ConfigFields';

export function CredentialsTab() {
  const { t } = useTranslation();
  const { adapters, isLoading } = useAdapters();
  const { credentials, updateCredential } = useLocalStorageCredentials();

  return (
    <div className="space-y-6">
      {isLoading && (
        <div className="text-muted-foreground text-sm">{t('credentials.loading')}</div>
      )}

      {!isLoading && adapters.length === 0 && (
        <div className="text-muted-foreground text-sm">{t('credentials.no_creds')}</div>
      )}

      {adapters.map((adapter) => (
        <section key={adapter.sourceType}>
          <h3 className="mb-3 text-sm font-semibold text-foreground">
            {adapter.sourceType}
          </h3>
          {adapter.credentialFields.map((field) => (
            <ConfigField
              key={field.key}
              label={field.label}
              type={field.secret ? 'password' : 'text'}
              value={credentials[adapter.sourceType]?.[field.key] ?? ''}
              onChange={(value) => updateCredential(adapter.sourceType, field.key, value)}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
