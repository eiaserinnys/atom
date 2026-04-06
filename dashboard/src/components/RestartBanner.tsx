import { useTranslation } from 'react-i18next';
import { useSystem } from '../contexts/SystemContext';

export function RestartBanner() {
  const { t } = useTranslation();
  const { pendingRestart, triggerRestart } = useSystem();

  if (!pendingRestart) return null;

  return (
    <div className="bg-yellow-500/10 border-b border-yellow-500/30 px-4 py-2 flex items-center justify-between shrink-0">
      <span className="text-sm text-yellow-300">{t('system.restart_required')}</span>
      <button
        className="px-3 py-1 text-xs font-medium rounded bg-yellow-600 text-white hover:bg-yellow-500"
        onClick={triggerRestart}
      >
        {t('system.restart_now')}
      </button>
    </div>
  );
}
