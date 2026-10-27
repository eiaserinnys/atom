import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, LogOut } from 'lucide-react';
import { api } from '../../api/client';
import type { UserRole } from '../../hooks/useAuth';
import { getVisibleConfigTabs, type ConfigTab } from './configCategories';

interface Props {
  currentUserRole: UserRole;
  activeTab: ConfigTab | null;
  onSelect: (tab: ConfigTab) => void;
  mobile?: boolean;
  showLogout?: boolean;
  selectedTabRef?: Ref<HTMLButtonElement>;
  hidden?: boolean;
}

export function ConfigCategoryNav({
  currentUserRole,
  activeTab,
  onSelect,
  mobile = false,
  showLogout = false,
  selectedTabRef,
  hidden = false,
}: Props) {
  const { t } = useTranslation();
  const tabs = getVisibleConfigTabs(currentUserRole);
  const handleLogout = () => {
    void api.logout().then(() => { window.location.href = '/'; });
  };

  return (
    <nav
      aria-label={t('config.settings')}
      hidden={hidden}
      className={mobile
        ? 'flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-6 py-6'
        : 'flex min-h-0 flex-col overflow-y-auto overscroll-contain border-r border-border bg-background px-3 py-6'}
    >
      <div className="flex flex-col">
        {tabs.map((item, index) => {
          const previous = tabs[index - 1];
          const selected = activeTab === item.id;
          const Icon = item.icon;
          return (
            <div key={item.id}>
              {previous && previous.group !== item.group && (
                <div className="my-2 border-t border-border" />
              )}
              <button
                ref={selected ? selectedTabRef : undefined}
                type="button"
                aria-current={selected ? 'page' : undefined}
                className={`flex w-full min-w-0 items-center gap-2 text-left text-sm text-foreground transition-colors ${
                  mobile ? 'min-h-14 px-0 py-2' : 'min-h-11 px-3 py-2'
                } ${selected ? 'bg-brand/10 font-semibold text-brand' : 'hover:bg-muted'}`}
                onClick={() => onSelect(item.id)}
              >
                <Icon className={`h-4 w-4 shrink-0 ${selected ? 'text-current' : 'text-muted-foreground'}`} strokeWidth={1.75} />
                <span className="min-w-0 flex-1 truncate">{t(item.labelKey)}</span>
                {mobile && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-65" strokeWidth={1.75} />}
              </button>
            </div>
          );
        })}
      </div>
      {mobile && showLogout && (
        <div className="mt-2 border-t border-border pt-2">
          <button
            type="button"
            className="flex min-h-14 w-full items-center gap-2 px-0 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
            <span className="min-w-0 flex-1 truncate">{t('app.logout')}</span>
          </button>
        </div>
      )}
    </nav>
  );
}
