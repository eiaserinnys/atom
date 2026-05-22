import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UserRole } from '../../hooks/useAuth';
import { UserManagementTab } from './UserManagementTab';
import { AgentManagementTab } from './AgentManagementTab';
import { CredentialsTab } from './CredentialsTab';
import { LanguageTab } from './LanguageTab';
import { DatabaseTab } from './DatabaseTab';
import { AuthTab } from './AuthTab';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentUserRole: UserRole;
  currentUserEmail: string;
}

type ConfigTab = 'users' | 'agents' | 'credentials' | 'language' | 'database' | 'auth';

export function ConfigModal({ isOpen, onClose, currentUserRole, currentUserEmail }: Props) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ConfigTab>(
    currentUserRole === 'admin' ? 'users' : 'agents'
  );
  const isAdmin = currentUserRole === 'admin';
  const visibleTab: ConfigTab = isAdmin || !['users', 'database', 'auth'].includes(activeTab)
    ? activeTab
    : 'agents';

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white dark:bg-card border border-border rounded-[14px] shadow-card dark:shadow-[rgba(0,0,0,0.5)_3px_5px_30px_0px] w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <span className="text-base font-semibold text-foreground">{t('config.settings')}</span>
          <button
            className="text-muted-foreground hover:text-foreground bg-transparent border-none cursor-pointer text-lg leading-none"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>

        {/* 탭 */}
        <div className="flex overflow-x-auto border-b border-border shrink-0">
          {isAdmin && (
            <button
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                visibleTab === 'users'
                  ? 'border-brand text-brand'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setActiveTab('users')}
            >
              {t('config.tab_users')}
            </button>
          )}
          <button
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              visibleTab === 'agents'
                ? 'border-brand text-brand'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab('agents')}
          >
            {t('config.tab_agents')}
          </button>
          <button
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              visibleTab === 'credentials'
                ? 'border-brand text-brand'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab('credentials')}
          >
            {t('config.tab_credentials')}
          </button>
          <button
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              visibleTab === 'language'
                ? 'border-brand text-brand'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab('language')}
          >
            {t('config.tab_language')}
          </button>
          {isAdmin && (
            <button
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                visibleTab === 'database'
                  ? 'border-brand text-brand'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setActiveTab('database')}
            >
              {t('config.tab_database')}
            </button>
          )}
          {isAdmin && (
            <button
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                visibleTab === 'auth'
                  ? 'border-brand text-brand'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setActiveTab('auth')}
            >
              {t('config.tab_auth')}
            </button>
          )}
        </div>

        {/* 탭 컨텐츠 */}
        <div className="flex-1 overflow-y-auto p-5">
          {visibleTab === 'users' && isAdmin && (
            <UserManagementTab currentUserEmail={currentUserEmail} />
          )}
          {visibleTab === 'agents' && <AgentManagementTab />}
          {visibleTab === 'credentials' && <CredentialsTab />}
          {visibleTab === 'language' && <LanguageTab />}
          {visibleTab === 'database' && isAdmin && <DatabaseTab />}
          {visibleTab === 'auth' && isAdmin && <AuthTab />}
        </div>
      </div>
    </div>
  );
}
