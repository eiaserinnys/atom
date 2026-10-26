import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { UserRole } from '../../hooks/useAuth';
import { useSystem } from '../../contexts/systemContext';
import { ConfigCategoryNav, getDefaultConfigTab, type ConfigTab } from './ConfigCategoryNav';
import { ConfigFooter } from './ConfigFooter';
import { ConfigTabPanel } from './ConfigTabPanel';
import type { AuthFooterState } from './AuthTab';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentUserRole: UserRole;
  currentUserEmail: string;
}

export function ConfigModal({ isOpen, onClose, currentUserRole, currentUserEmail }: Props) {
  const { t } = useTranslation();
  const { pendingRestart, triggerRestart } = useSystem();
  const [activeTab, setActiveTab] = useState<ConfigTab>(() => getDefaultConfigTab(currentUserRole));
  const [authFooter, setAuthFooter] = useState<AuthFooterState | null>(null);
  const selectedTabRef = useRef<HTMLButtonElement>(null);

  const handleClose = useCallback(() => {
    setActiveTab(getDefaultConfigTab(currentUserRole));
    setAuthFooter(null);
    onClose();
  }, [currentUserRole, onClose]);

  useEffect(() => {
    if (!isOpen) {
      setActiveTab(getDefaultConfigTab(currentUserRole));
      setAuthFooter(null);
      return;
    }
    selectedTabRef.current?.focus();
  }, [currentUserRole, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleClose, isOpen]);

  const handleTabSelect = (tab: ConfigTab) => {
    setAuthFooter(null);
    setActiveTab(tab);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 dark:bg-black/70"
      onClick={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('config.settings')}
        className="flex h-[min(48rem,calc(100dvh-64px))] w-full max-w-5xl flex-col overflow-hidden border border-border bg-card"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <span className="text-base font-semibold text-foreground">{t('config.settings')}</span>
          <button
            type="button"
            className="index-action w-8 h-8 !p-0 text-muted-foreground hover:text-foreground"
            onClick={handleClose}
            aria-label={t('common.close')}
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,3fr)] grid-rows-[minmax(0,1fr)] overflow-hidden">
          <ConfigCategoryNav
            currentUserRole={currentUserRole}
            activeTab={activeTab}
            onSelect={handleTabSelect}
            selectedTabRef={selectedTabRef}
          />
          <ConfigTabPanel
            tab={activeTab}
            currentUserRole={currentUserRole}
            currentUserEmail={currentUserEmail}
            onAuthFooterChange={setAuthFooter}
          />
        </div>

        <ConfigFooter
          activeTab={activeTab}
          pendingRestart={pendingRestart}
          triggerRestart={triggerRestart}
          onClose={handleClose}
          authFooter={authFooter}
        />
      </div>
    </div>
  );
}
