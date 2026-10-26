import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ConfigActionButton } from './ConfigFields';
import type { ConfigTab } from './ConfigCategoryNav';
import type { AuthFooterState } from './AuthTab';

interface Props {
  activeTab: ConfigTab | null;
  mobile?: boolean;
  pendingRestart: boolean;
  triggerRestart: () => void;
  onClose?: () => void;
  authFooter: AuthFooterState | null;
}

export function ConfigFooter({
  activeTab,
  mobile = false,
  pendingRestart,
  triggerRestart,
  onClose,
  authFooter,
}: Props) {
  const { t } = useTranslation();
  const isAuthTab = activeTab === 'auth';

  if (mobile && !isAuthTab && !pendingRestart) return null;

  return (
    <footer className="shrink-0 border-t border-border px-6 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto flex min-w-0 items-center text-sm text-muted-foreground" aria-live="polite">
          {pendingRestart ? (
            <span className="flex items-center gap-2 text-[var(--amber)]">
              <TriangleAlert className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              {t('system.restart_required')}
            </span>
          ) : isAuthTab && authFooter?.message ? (
            <span className={authFooter.message.ok ? 'text-muted-foreground' : 'text-node-error'}>
              {authFooter.message.text}
            </span>
          ) : null}
        </div>
        {!mobile && (
          <ConfigActionButton tone="secondary" onClick={onClose ?? (() => undefined)}>
            {t('common.close')}
          </ConfigActionButton>
        )}
        {pendingRestart ? (
          <ConfigActionButton onClick={triggerRestart}>{t('system.restart_now')}</ConfigActionButton>
        ) : isAuthTab ? (
          <ConfigActionButton onClick={() => { void authFooter?.onSave(); }} disabled={authFooter?.disabled ?? true}>
            {authFooter?.saving ? t('common.loading') : t('auth.save')}
          </ConfigActionButton>
        ) : null}
      </div>
    </footer>
  );
}
