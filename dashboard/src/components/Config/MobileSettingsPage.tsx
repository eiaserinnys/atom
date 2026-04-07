import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UserRole } from '../../hooks/useAuth';
import { AgentManagementTab } from './AgentManagementTab';
import { CredentialsTab } from './CredentialsTab';
import { LanguageTab } from './LanguageTab';
import { UserManagementTab } from './UserManagementTab';
import { DatabaseTab } from './DatabaseTab';
import { AuthTab } from './AuthTab';

type SubTab = 'users' | 'agents' | 'credentials' | 'language' | 'database' | 'auth' | null;

interface Props {
  currentUserRole: UserRole;
  currentUserEmail: string;
}

interface MenuItem {
  id: SubTab & string;
  labelKey: string;
  adminOnly?: boolean;
}

const MENU_ITEMS: MenuItem[] = [
  { id: 'agents',      labelKey: 'config.tab_agents' },
  { id: 'credentials', labelKey: 'config.tab_credentials' },
  { id: 'language',    labelKey: 'config.tab_language' },
  { id: 'users',       labelKey: 'config.tab_users',    adminOnly: true },
  { id: 'database',    labelKey: 'config.tab_database', adminOnly: true },
  { id: 'auth',        labelKey: 'config.tab_auth',     adminOnly: true },
];

export function MobileSettingsPage({ currentUserRole, currentUserEmail }: Props) {
  const { t } = useTranslation();
  const [activeSubTab, setActiveSubTab] = useState<SubTab>(null);

  const isAdmin = currentUserRole === 'admin';
  const visibleItems = MENU_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  const adminItems = visibleItems.filter((item) => item.adminOnly);
  const commonItems = visibleItems.filter((item) => !item.adminOnly);

  if (activeSubTab !== null) {
    const currentItem = MENU_ITEMS.find((item) => item.id === activeSubTab);
    return (
      <div className="flex h-full flex-col">
        {/* 서브탭 헤더 */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3 shrink-0">
          <button
            className="text-[17px] font-medium text-node-user"
            onClick={() => setActiveSubTab(null)}
          >
            {t('mobile.settings_back')}
          </button>
          <span className="text-[17px] font-semibold text-foreground">
            {currentItem ? t(currentItem.labelKey) : ''}
          </span>
        </div>
        {/* 서브탭 콘텐츠 */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeSubTab === 'agents' && <AgentManagementTab />}
          {activeSubTab === 'credentials' && <CredentialsTab />}
          {activeSubTab === 'language' && <LanguageTab />}
          {activeSubTab === 'users' && isAdmin && (
            <UserManagementTab currentUserEmail={currentUserEmail} />
          )}
          {activeSubTab === 'database' && isAdmin && <DatabaseTab />}
          {activeSubTab === 'auth' && isAdmin && <AuthTab />}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* 설정 헤더 */}
      <div className="px-4 py-4 border-b border-border">
        <span className="text-[17px] font-semibold text-foreground">
          {t('config.settings')}
        </span>
      </div>

      {/* 공통 항목 */}
      <div className="flex flex-col">
        {commonItems.map((item) => (
          <button
            key={item.id}
            className="flex h-14 w-full items-center justify-between border-b border-border px-4 text-[17px] text-foreground transition-colors hover:bg-muted/30 active:bg-muted/50"
            onClick={() => setActiveSubTab(item.id)}
          >
            <span>{t(item.labelKey)}</span>
            <span className="text-muted-foreground">›</span>
          </button>
        ))}
      </div>

      {/* admin 전용 항목 구분선 + 목록 */}
      {adminItems.length > 0 && (
        <>
          <div className="my-2 mx-4 border-t border-border" />
          <div className="flex flex-col">
            {adminItems.map((item) => (
              <button
                key={item.id}
                className="flex h-14 w-full items-center justify-between border-b border-border px-4 text-[17px] text-foreground transition-colors hover:bg-muted/30 active:bg-muted/50"
                onClick={() => setActiveSubTab(item.id)}
              >
                <span>{t(item.labelKey)}</span>
                <span className="text-muted-foreground">›</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
