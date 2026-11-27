import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ConfigActionButton } from './ConfigFields';
import type { ConfigTab } from './configCategories';
import type { AuthFooterState } from './AuthTab';

interface Props {
  activeTab: ConfigTab | null;
  mobile?: boolean;
  pendingRestart: boolean;
  manualRestartRequired: boolean;
  triggerRestart: () => void;
  onClose?: () => void;
  authFooter: AuthFooterState | null;
}

export function ConfigFooter({
  activeTab,
  mobile = false,
  pendingRestart,
  manualRestartRequired,
  triggerRestart,
  onClose,
  authFooter,
}: Props) {
  const { t } = useTranslation();
  const isAuthTab = activeTab === 'auth';

  if (mobile && !isAuthTab) return null;

  return (
    <footer className="shrink-0 border-t border-border px-6 py-4">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center text-sm text-muted-foreground" aria-live="polite">
          {pendingRestart && !mobile ? (
            <span className="flex items-center gap-2 text-foreground [&:lang(ko)]:break-keep">
              <TriangleAlert className="h-4 w-4 shrink-0 text-[var(--amber)]" strokeWidth={1.75} />
              {manualRestartRequired ? t('system.restart_manual') : t('system.restart_required')}
            </span>
          ) : !pendingRestart && isAuthTab && authFooter?.message ? (
            <span className={`[&:lang(ko)]:break-keep [overflow-wrap:anywhere] ${authFooter.message.ok ? 'text-muted-foreground' : 'text-node-error'}`}>
              {authFooter.message.text}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!mobile && (
            <ConfigActionButton tone="secondary" onClick={onClose ?? (() => undefined)}>
              {t('common.close')}
            </ConfigActionButton>
          )}
          {pendingRestart && !mobile ? (
            <ConfigActionButton onClick={triggerRestart}>
              {manualRestartRequired ? t('system.shutdown_now') : t('system.restart_now')}
            </ConfigActionButton>
          ) : isAuthTab ? (
            <ConfigActionButton onClick={() => { void authFooter?.onSave(); }} disabled={authFooter?.disabled ?? true}>
              {authFooter?.saving ? t('common.loading') : t('auth.save')}
            </ConfigActionButton>
          ) : null}
        </div>
      </div>
    </footer>
  );
}
