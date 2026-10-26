import { useTranslation } from 'react-i18next';
import { TriangleAlert } from 'lucide-react';
import { useSystem } from '../contexts/systemContext';
import { ConfigActionButton } from './Config/ConfigFields';

export function RestartBanner() {
  const { t } = useTranslation();
  const { pendingRestart, triggerRestart } = useSystem();

  if (!pendingRestart) return null;

  return (
    <div className="bg-[var(--amber-soft)] border-b border-[var(--amber)]/30 px-4 py-2 flex items-center gap-2 shrink-0">
      <TriangleAlert className="w-4 h-4 shrink-0 text-[var(--amber)]" strokeWidth={1.75} aria-hidden="true" />
      <span className="flex-1 text-sm text-foreground">{t('system.restart_required')}</span>
      <ConfigActionButton onClick={triggerRestart}>{t('system.restart_now')}</ConfigActionButton>
    </div>
  );
}
