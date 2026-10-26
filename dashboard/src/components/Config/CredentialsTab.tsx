import { useTranslation } from 'react-i18next';
import { useAdapters } from '../../hooks/useAdapters';
import { useLocalStorageCredentials } from '../../hooks/useLocalStorageCredentials';
import { CONFIG_CONTROL_CLASS } from './ConfigFields';

export function CredentialsTab() {
  const { t } = useTranslation();
  const { adapters, isLoading } = useAdapters();
  const { credentials, updateCredential } = useLocalStorageCredentials();

  return (
    <div className="flex flex-col gap-5">
      {isLoading && (
        <div className="text-muted-foreground text-sm">{t('credentials.loading')}</div>
      )}

      {!isLoading && adapters.length === 0 && (
        <div className="text-muted-foreground text-sm">{t('credentials.no_creds')}</div>
      )}

      {adapters.map((adapter) => (
        <div key={adapter.sourceType} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            {adapter.sourceType}
          </h3>
          <div className="flex flex-col gap-2 bg-card border border-border rounded-none px-3 py-3">
            {adapter.credentialFields.map((field) => (
              <div key={field.key} className="flex items-center gap-2">
                <label className="text-[13px] text-muted-foreground w-24 shrink-0">
                  {field.label}
                </label>
                <input
                  type={field.secret ? 'password' : 'text'}
                  placeholder={field.hint ?? ''}
                  value={credentials[adapter.sourceType]?.[field.key] ?? ''}
                  onChange={(e) =>
                    updateCredential(adapter.sourceType, field.key, e.target.value)
                  }
                  className={`w-full ${CONFIG_CONTROL_CLASS}`}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
