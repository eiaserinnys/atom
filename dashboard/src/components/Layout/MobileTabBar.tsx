import { useTranslation } from 'react-i18next';

export type MobileTab = 'tree' | 'compile' | 'search' | 'detail' | 'settings';

interface Props {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
  showSettings: boolean;
}

const TABS: { id: MobileTab; icon: string; labelKey: string }[] = [
  { id: 'tree',     icon: '🌳', labelKey: 'mobile.tab_tree' },
  { id: 'compile',  icon: '📄', labelKey: 'mobile.tab_compile' },
  { id: 'search', icon: '⌕', labelKey: 'mobile.tab_search' },
  { id: 'detail',   icon: '🃏', labelKey: 'mobile.tab_detail' },
  { id: 'settings', icon: '⚙️', labelKey: 'mobile.tab_settings' },
];

export function MobileTabBar({ activeTab, onTabChange, showSettings }: Props) {
  const { t } = useTranslation();

  const visibleTabs = showSettings ? TABS : TABS.filter((tab) => tab.id !== 'settings');

  return (
    <div
      className="h-14 shrink-0 z-50 flex border-t border-border bg-card"
      role="tablist" aria-label="모바일 탐색"
    >
      {visibleTabs.map((tab) => (
        <button
          key={tab.id}
          role="tab" aria-selected={activeTab === tab.id}
          className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 pt-2 text-[13px] font-medium transition-colors ${
            activeTab === tab.id
              ? 'text-brand'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => onTabChange(tab.id)}
        >
          <span className="text-[20px] leading-none">{tab.icon}</span>
          <span className="whitespace-nowrap truncate max-w-full px-1">{t(tab.labelKey)}</span>
        </button>
      ))}
    </div>
  );
}
