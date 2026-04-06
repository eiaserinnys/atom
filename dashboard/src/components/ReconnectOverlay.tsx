import { useTranslation } from 'react-i18next';
import { useSystem } from '../contexts/SystemContext';

export function ReconnectOverlay() {
  const { t } = useTranslation();
  const { reconnecting } = useSystem();

  if (!reconnecting) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70">
      <div className="text-center space-y-4">
        <div className="animate-spin w-8 h-8 border-2 border-foreground border-t-transparent rounded-full mx-auto" />
        <p className="text-foreground text-sm">{t('system.reconnecting')}</p>
      </div>
    </div>
  );
}
