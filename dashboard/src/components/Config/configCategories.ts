import {
  Database,
  KeyRound,
  Languages,
  Link2,
  Plug,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { UserRole } from '../../hooks/useAuth';

export type ConfigTab = 'agents' | 'users' | 'auth' | 'openai' | 'database' | 'language' | 'credentials';

interface ConfigTabItem {
  id: ConfigTab;
  labelKey: string;
  icon: LucideIcon;
  group: 'server' | 'local';
  adminOnly?: boolean;
}

const CONFIG_TABS: ConfigTabItem[] = [
  { id: 'agents', labelKey: 'config.tab_agents', icon: KeyRound, group: 'server' },
  { id: 'users', labelKey: 'config.tab_users', icon: Users, group: 'server', adminOnly: true },
  { id: 'auth', labelKey: 'config.tab_auth', icon: ShieldCheck, group: 'server', adminOnly: true },
  { id: 'openai', labelKey: 'config.tab_openai', icon: Plug, group: 'server', adminOnly: true },
  { id: 'database', labelKey: 'config.tab_database', icon: Database, group: 'server', adminOnly: true },
  { id: 'language', labelKey: 'config.tab_language', icon: Languages, group: 'local' },
  { id: 'credentials', labelKey: 'config.tab_credentials', icon: Link2, group: 'local' },
];

export function getVisibleConfigTabs(role: UserRole): ConfigTabItem[] {
  return CONFIG_TABS.filter((item) => !item.adminOnly || role === 'admin')
    .filter((item) => item.id !== 'agents' || role !== 'viewer');
}

export function getDefaultConfigTab(role: UserRole): ConfigTab {
  return getVisibleConfigTabs(role)[0]?.id ?? 'language';
}
