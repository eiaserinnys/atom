import { useTranslation } from 'react-i18next';
import { useSystem } from '../contexts/systemContext';
import { Spinner } from './Spinner';

export function ReconnectOverlay() {
  const { t } = useTranslation();
  const { reconnecting } = useSystem();

  if (!reconnecting) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 dark:bg-black/70">
      <div role="status" className="bg-card border border-border p-6 flex flex-col items-center gap-3">
        <Spinner />
        <p className="text-sm text-foreground">{t('system.reconnecting')}</p>
      </div>
    </div>
  );
}
