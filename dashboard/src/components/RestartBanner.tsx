import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSystem } from '../contexts/systemContext';
import { ConfigActionButton } from './Config/ConfigFields';

export function RestartBanner() {
  const { t } = useTranslation();
  const { pendingRestart, triggerRestart } = useSystem();

  if (!pendingRestart) return null;

  return (
    <div className="bg-card border-b border-border px-6 py-4 flex flex-wrap items-center gap-2 shrink-0">
      <span className="mr-auto flex min-w-0 items-center gap-2 text-sm text-foreground">
        <TriangleAlert className="h-4 w-4 shrink-0 text-[var(--amber)]" strokeWidth={1.75} />
        {t('system.restart_required')}
      </span>
      <ConfigActionButton tone="brand" onClick={triggerRestart}>
        {t('system.restart_now')}
      </ConfigActionButton>
    </div>
  );
}
