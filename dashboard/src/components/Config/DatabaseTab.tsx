import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Folder, XCircle } from 'lucide-react';
import { configApi } from '../../api/client';
import { useSystem } from '../../contexts/systemContext';
import { ConfigActionButton, CONFIG_CONTROL_CLASS } from './ConfigFields';

interface DbInfo {
  dbType: 'postgres' | 'sqlite';
  sqliteFile: string;
  sqliteFileExists: boolean;
  deprecatedFileExists: boolean;
}

export function DatabaseTab() {
  const { t } = useTranslation();
  const { pendingRestart } = useSystem();
  const [info, setInfo] = useState<DbInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [migrateResult, setMigrateResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [showMigrationConfirm, setShowMigrationConfirm] = useState(false);
  const [connUrl, setConnUrl] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [savingUrl, setSavingUrl] = useState(false);
  const migrationDialogRef = useRef<HTMLDivElement>(null);

  const fetchInfo = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await configApi.getDbInfo();
      setInfo(data as DbInfo);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchInfo(); }, [fetchInfo]);

  useEffect(() => {
    if (showMigrationConfirm) {
      migrationDialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    }
  }, [showMigrationConfirm]);

  const handleMigrate = async () => {
    setMigrating(true);
    setMigrateResult(null);
    try {
      const baseUrl = import.meta.env.VITE_API_BASE_URL ?? '';
      const response = await fetch(`${baseUrl}/api/config/migrate-to-pg`, {
        method: 'POST', credentials: 'same-origin',
      });
      const data = await response.json();
      if (!response.ok) {
        setMigrateResult({ ok: false, message: data.error ?? 'Unknown error' });
      } else {
        setMigrateResult({ ok: true, message: data.message ?? 'Migration completed.' });
        void fetchInfo();
      }
    } catch (err) {
      setMigrateResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setMigrating(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await configApi.testDbConnection(connUrl);
      setTestResult(result);
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveUrl = async () => {
    setSavingUrl(true);
    try {
      await configApi.putEnv([{ key: 'DATABASE_URL', value: connUrl }]);
      setTestResult(null);
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSavingUrl(false);
    }
  };

  if (loading) return <div className="text-muted-foreground text-sm">{t('common.loading')}</div>;
  if (error) return <div className="text-node-error text-sm">{t('common.error')}: {error}</div>;
  if (!info) return null;

  const isPostgres = info.dbType === 'postgres';
  const canMigrate = isPostgres && info.sqliteFileExists && !info.deprecatedFileExists;

  return (
    <div className="space-y-6">
      <p className="text-sm text-foreground">
        {t('database.mode_label')}: {isPostgres ? 'PostgreSQL' : 'SQLite'}
      </p>

      {!isPostgres && (
        <section>
          <h3 className="mb-3 text-sm font-semibold text-foreground">{t('database.connection_string')}</h3>
          <div className="flex flex-col gap-3">
            <input
              type="text"
              aria-label={t('database.connection_string')}
              className={`w-full ${CONFIG_CONTROL_CLASS}`}
              placeholder="postgresql://user:pass@host:5432/dbname"
              value={connUrl}
              onChange={(event) => { setConnUrl(event.target.value); setTestResult(null); }}
              disabled={pendingRestart}
            />
            <div className="flex flex-wrap gap-2">
              <ConfigActionButton
                onClick={handleTestConnection}
                disabled={!connUrl || testing || pendingRestart}
              >
                {testing ? t('common.loading') : t('database.test_connection')}
              </ConfigActionButton>
              {testResult?.ok && (
                <ConfigActionButton onClick={handleSaveUrl} disabled={savingUrl || pendingRestart}>
                  {savingUrl ? t('common.loading') : t('database.save_url')}
                </ConfigActionButton>
              )}
            </div>
            {testResult && (
              <div className={`text-[13px] ${testResult.ok ? 'text-brand' : 'text-node-error'}`}>
                {testResult.ok
                  ? <><CheckCircle2 className="mr-1 inline-block h-3.5 w-3.5 align-text-bottom" strokeWidth={1.75} />{t('database.test_success')}</>
                  : <><XCircle className="mr-1 inline-block h-3.5 w-3.5 align-text-bottom" strokeWidth={1.75} />{t('database.test_failed')}: {testResult.error}</>}
              </div>
            )}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-3 text-sm font-semibold text-foreground">{t('database.file_label')}</h3>
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-start gap-2 text-sm">
            <span className="shrink-0 whitespace-nowrap text-muted-foreground">{t('database.file_path')}</span>
            <code className="min-w-0 break-words text-[13px] text-foreground [overflow-wrap:anywhere]">{info.sqliteFile}</code>
          </div>
          {isPostgres && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="shrink-0 whitespace-nowrap text-muted-foreground">{t('database.file_status')}:</span>
              {info.deprecatedFileExists ? (
                <span className="text-brand text-[13px]"><CheckCircle2 className="mr-1 inline-block h-3.5 w-3.5 align-text-bottom" strokeWidth={1.75} />{t('database.file_migrated')}</span>
              ) : info.sqliteFileExists ? (
                <span className="text-[var(--amber)] text-[13px]"><Folder className="mr-1 inline-block h-3.5 w-3.5 align-text-bottom" strokeWidth={1.75} />{t('database.file_exists')}</span>
              ) : (
                <span className="text-muted-foreground text-[13px]">{t('database.file_none')}</span>
              )}
            </div>
          )}
        </div>
      </section>

      {isPostgres && (
        <section>
          <h3 className="mb-3 text-sm font-semibold text-foreground">{t('database.migration_label')}</h3>
          <div className="flex flex-col gap-3">
            {info.deprecatedFileExists ? (
              <div className="text-[13px] text-muted-foreground">{t('database.migration_done')}</div>
            ) : !info.sqliteFileExists ? (
              <div className="text-[13px] text-muted-foreground">{t('database.migration_no_file')}</div>
            ) : (
              <>
                <div className="text-[13px] text-muted-foreground">{t('database.migration_desc')}</div>
                <div className="self-start">
                  <ConfigActionButton
                    disabled={!canMigrate || migrating}
                    onClick={() => setShowMigrationConfirm(true)}
                  >
                    {migrating ? t('database.migration_running') : t('database.migration_btn')}
                  </ConfigActionButton>
                </div>
              </>
            )}
            {migrateResult && (
              <div className={`border px-3 py-2 text-[13px] ${migrateResult.ok ? 'border-brand/30 bg-brand/10 text-brand' : 'border-node-error/30 bg-muted text-node-error'}`}>
                {migrateResult.ok
                  ? <><CheckCircle2 className="mr-1 inline-block h-3.5 w-3.5 align-text-bottom" strokeWidth={1.75} />{migrateResult.message}</>
                  : <><XCircle className="mr-1 inline-block h-3.5 w-3.5 align-text-bottom" strokeWidth={1.75} />{migrateResult.message}</>}
              </div>
            )}
          </div>
        </section>
      )}

      {showMigrationConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 dark:bg-black/70"
          role="presentation"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setShowMigrationConfirm(false);
            }
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowMigrationConfirm(false);
          }}
        >
          <div ref={migrationDialogRef} role="dialog" aria-modal="true" aria-labelledby="database-migration-title" className="flex w-full max-w-sm flex-col gap-4 border border-border bg-card p-6">
            <h2 id="database-migration-title" className="text-base font-semibold text-foreground">{t('database.migration_label')}</h2>
            <p className="whitespace-pre-line text-sm text-foreground">{t('database.migration_confirm')}</p>
            <div className="flex justify-end gap-2">
              <ConfigActionButton tone="secondary" onClick={() => setShowMigrationConfirm(false)}>
                {t('common.cancel')}
              </ConfigActionButton>
              <ConfigActionButton
                onClick={() => {
                  setShowMigrationConfirm(false);
                  void handleMigrate();
                }}
              >
                {t('common.confirm')}
              </ConfigActionButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
