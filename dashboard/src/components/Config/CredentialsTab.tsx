import { useTranslation } from 'react-i18next';
import { useAdapters } from '../../hooks/useAdapters';
import { useLocalStorageCredentials } from '../../hooks/useLocalStorageCredentials';

export function CredentialsTab() {
  const { t } = useTranslation();
  const { adapters, isLoading } = useAdapters();
  const { credentials, updateCredential } = useLocalStorageCredentials();

  return (
    <div className="flex flex-col gap-5">
      <div className="text-xs text-muted-foreground">
        {t('credentials.desc')}
      </div>

      {isLoading && (
        <div className="text-muted-foreground text-sm">{t('credentials.loading')}</div>
      )}

      {!isLoading && adapters.length === 0 && (
        <div className="text-muted-foreground text-sm">{t('credentials.no_creds')}</div>
      )}

      {adapters.map((adapter) => (
        <div key={adapter.sourceType} className="flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {adapter.sourceType}
          </div>
          <div className="flex flex-col gap-2 bg-card border border-border rounded px-3 py-3">
            {adapter.credentialFields.map((field) => (
              <div key={field.key} className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground w-24 shrink-0">
                  {field.label}
                </label>
                <input
                  type={field.secret ? 'password' : 'text'}
                  placeholder={field.hint ?? ''}
                  value={credentials[adapter.sourceType]?.[field.key] ?? ''}
                  onChange={(e) =>
                    updateCredential(adapter.sourceType, field.key, e.target.value)
                  }
                  className="flex-1 text-sm bg-background border border-border rounded px-2.5 py-1.5 text-foreground outline-none focus:border-brand font-sans"
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
