import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { UserRole } from '../../hooks/useAuth';
import { AgentManagementTab } from './AgentManagementTab';
import { AuthTab, type AuthFooterState } from './AuthTab';
import { CredentialsTab } from './CredentialsTab';
import { DatabaseTab } from './DatabaseTab';
import { LanguageTab } from './LanguageTab';
import { OpenAITab } from './OpenAITab';
import { UserManagementTab } from './UserManagementTab';
import type { ConfigTab } from './ConfigCategoryNav';

const LABEL_KEYS: Record<ConfigTab, string> = {
  agents: 'config.tab_agents',
  users: 'config.tab_users',
  auth: 'config.tab_auth',
  openai: 'config.tab_openai',
  database: 'config.tab_database',
  language: 'config.tab_language',
  credentials: 'config.tab_credentials',
};

interface Props {
  tab: ConfigTab;
  currentUserRole: UserRole;
  currentUserEmail: string;
  mobile?: boolean;
  onBack?: () => void;
  onAuthFooterChange?: (state: AuthFooterState) => void;
}

export function ConfigTabPanel({
  tab,
  currentUserRole,
  currentUserEmail,
  mobile = false,
  onBack,
  onAuthFooterChange,
}: Props) {
  const { t } = useTranslation();
  const label = t(LABEL_KEYS[tab]);

  return (
    <section
      aria-label={label}
      className={`min-w-0 min-h-0 overflow-y-auto overscroll-contain p-6 ${mobile ? 'flex-1' : ''}`}
    >
      {mobile && (
        <button
          type="button"
          className="mb-3 flex min-h-11 items-center gap-2 text-sm text-brand"
          onClick={onBack}
        >
          <ArrowLeft className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          {t('config.settings')}
        </button>
      )}
      <h2 className="mb-6 text-base font-semibold text-foreground">{label}</h2>
      {tab === 'agents' && <AgentManagementTab currentUserRole={currentUserRole} />}
      {tab === 'users' && currentUserRole === 'admin' && (
        <UserManagementTab currentUserEmail={currentUserEmail} />
      )}
      {tab === 'auth' && currentUserRole === 'admin' && (
        <AuthTab onFooterChange={onAuthFooterChange} />
      )}
      {tab === 'openai' && currentUserRole === 'admin' && <OpenAITab />}
      {tab === 'database' && currentUserRole === 'admin' && <DatabaseTab />}
      {tab === 'language' && <LanguageTab />}
      {tab === 'credentials' && <CredentialsTab />}
    </section>
  );
}
