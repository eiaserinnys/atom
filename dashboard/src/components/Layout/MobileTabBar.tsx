import { useTranslation } from 'react-i18next';

export type MobileTab = 'tree' | 'compile' | 'detail' | 'settings';

interface Props {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
  showSettings: boolean;
}

const TABS: { id: MobileTab; icon: string; labelKey: string }[] = [
  { id: 'tree',     icon: '🌳', labelKey: 'mobile.tab_tree' },
  { id: 'compile',  icon: '📄', labelKey: 'mobile.tab_compile' },
  { id: 'detail',   icon: '🃏', labelKey: 'mobile.tab_detail' },
  { id: 'settings', icon: '⚙️', labelKey: 'mobile.tab_settings' },
];

export function MobileTabBar({ activeTab, onTabChange, showSettings }: Props) {
  const { t } = useTranslation();

  const visibleTabs = showSettings ? TABS : TABS.filter((tab) => tab.id !== 'settings');

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-border bg-card"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)' }}
    >
      {visibleTabs.map((tab) => (
        <button
          key={tab.id}
          className={`flex flex-1 flex-col items-center justify-center gap-0.5 pt-2 text-[12px] font-medium transition-colors ${
            activeTab === tab.id
              ? 'text-node-user'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => onTabChange(tab.id)}
        >
          <span className="text-[20px] leading-none">{tab.icon}</span>
          <span>{t(tab.labelKey)}</span>
        </button>
      ))}
    </div>
  );
}
