import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

interface DbInfo {
  dbType: 'postgres' | 'sqlite';
  sqliteFile: string;
  sqliteFileExists: boolean;
  deprecatedFileExists: boolean;
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export function DatabaseTab() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<DbInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [migrateResult, setMigrateResult] = useState<{ ok: boolean; message: string } | null>(null);

  const fetchInfo = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE_URL}/api/config/db-info`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      setInfo(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchInfo(); }, [fetchInfo]);

  const handleMigrate = async () => {
    if (!window.confirm(t('database.migration_confirm'))) return;

    setMigrating(true);
    setMigrateResult(null);
    try {
      const res = await fetch(`${BASE_URL}/api/config/migrate-to-pg`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      const data = await res.json();
      if (!res.ok) {
        setMigrateResult({ ok: false, message: data.error ?? 'Unknown error' });
      } else {
        setMigrateResult({ ok: true, message: data.message ?? 'Migration completed.' });
        fetchInfo(); // refresh info
      }
    } catch (err) {
      setMigrateResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setMigrating(false);
    }
  };

  if (loading) {
    return <div className="text-muted-foreground text-sm">{t('common.loading')}</div>;
  }

  if (error) {
    return <div className="text-red-400 text-sm">{t('common.error')}: {error}</div>;
  }

  if (!info) return null;

  const isPostgres = info.dbType === 'postgres';
  const canMigrate = isPostgres && info.sqliteFileExists && !info.deprecatedFileExists;

  return (
    <div className="flex flex-col gap-5">
      <div className="text-xs text-muted-foreground">
        {t('database.desc')}
      </div>

      {/* DB Mode */}
      <div className="flex flex-col gap-2">
        <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t('database.mode_label')}
        </div>
        <div className="flex items-center gap-2 bg-card border border-border rounded px-3 py-3">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
              isPostgres
                ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
            }`}
          >
            <span>{isPostgres ? '🟢' : '🟡'}</span>
            {isPostgres ? 'PostgreSQL' : 'SQLite'}
          </span>
        </div>
      </div>

      {/* SQLite file info */}
      <div className="flex flex-col gap-2">
        <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t('database.file_label')}
        </div>
        <div className="flex flex-col gap-1.5 bg-card border border-border rounded px-3 py-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t('database.file_path')}</span>
            <code className="text-xs bg-background px-1.5 py-0.5 rounded text-foreground">
              {info.sqliteFile}
            </code>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t('database.file_status')}:</span>
            {info.deprecatedFileExists ? (
              <span className="text-green-400 text-xs">✅ {t('database.file_migrated')}</span>
            ) : info.sqliteFileExists ? (
              <span className="text-yellow-400 text-xs">📁 {t('database.file_exists')}</span>
            ) : (
              <span className="text-muted-foreground text-xs">{t('database.file_none')}</span>
            )}
          </div>
        </div>
      </div>

      {/* Migration */}
      {isPostgres && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {t('database.migration_label')}
          </div>
          <div className="flex flex-col gap-3 bg-card border border-border rounded px-3 py-3">
            {info.deprecatedFileExists ? (
              <div className="text-xs text-muted-foreground">
                {t('database.migration_done')}
              </div>
            ) : !info.sqliteFileExists ? (
              <div className="text-xs text-muted-foreground">
                {t('database.migration_no_file')}
              </div>
            ) : (
              <>
                <div className="text-xs text-muted-foreground">
                  {t('database.migration_desc')}
                </div>
                <button
                  className={`self-start px-4 py-2 rounded text-sm font-medium transition-colors ${
                    canMigrate && !migrating
                      ? 'bg-node-user text-white hover:opacity-90 cursor-pointer'
                      : 'bg-muted text-muted-foreground cursor-not-allowed'
                  }`}
                  disabled={!canMigrate || migrating}
                  onClick={handleMigrate}
                >
                  {migrating ? t('database.migration_running') : t('database.migration_btn')}
                </button>
              </>
            )}

            {migrateResult && (
              <div
                className={`text-xs px-3 py-2 rounded ${
                  migrateResult.ok
                    ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                    : 'bg-red-500/10 text-red-400 border border-red-500/20'
                }`}
              >
                {migrateResult.ok ? '✅ ' : '❌ '}
                {migrateResult.message}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
