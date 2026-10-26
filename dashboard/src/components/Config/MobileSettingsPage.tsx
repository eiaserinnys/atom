import { useCallback, useState } from 'react';
import { useSystem } from '../../contexts/systemContext';
import type { UserRole } from '../../hooks/useAuth';
import { ConfigCategoryNav, type ConfigTab } from './ConfigCategoryNav';
import { ConfigFooter } from './ConfigFooter';
import { ConfigTabPanel } from './ConfigTabPanel';
import type { AuthFooterState } from './AuthTab';

interface Props {
  currentUserRole: UserRole;
  currentUserEmail: string;
}

export function MobileSettingsPage({ currentUserRole, currentUserEmail }: Props) {
  const { pendingRestart, triggerRestart } = useSystem();
  const [activeTab, setActiveTab] = useState<ConfigTab | null>(null);
  const [authFooter, setAuthFooter] = useState<AuthFooterState | null>(null);

  const handleSelect = (tab: ConfigTab) => {
    setAuthFooter(null);
    setActiveTab(tab);
  };

  const handleBack = useCallback(() => {
    setAuthFooter(null);
    setActiveTab(null);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ConfigCategoryNav
        currentUserRole={currentUserRole}
        activeTab={activeTab}
        onSelect={handleSelect}
        mobile
        showLogout
        hidden={activeTab !== null}
      />
      {activeTab !== null && (
        <ConfigTabPanel
          tab={activeTab}
          currentUserRole={currentUserRole}
          currentUserEmail={currentUserEmail}
          mobile
          onBack={handleBack}
          onAuthFooterChange={setAuthFooter}
        />
      )}
      <ConfigFooter
        activeTab={activeTab}
        mobile
        pendingRestart={pendingRestart}
        triggerRestart={triggerRestart}
        authFooter={authFooter}
      />
    </div>
  );
}
