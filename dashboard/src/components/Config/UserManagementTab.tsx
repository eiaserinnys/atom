import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfig } from '../../hooks/useConfig';
import type { UserRole } from '../../api/client';

interface Props {
  currentUserEmail: string;
}

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'admin',
  editor: 'editor',
  viewer: 'viewer',
};

export function UserManagementTab({ currentUserEmail }: Props) {
  const { t } = useTranslation();
  const { users, loading, loadUsers, addUser, updateUser } = useConfig();
  const [newEmail, setNewEmail] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('editor');
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [updateErrors, setUpdateErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleAdd = async () => {
    if (!newEmail.trim()) {
      setAddError('이메일을 입력하세요.');
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      await addUser({
        email: newEmail.trim(),
        display_name: newDisplayName.trim() || undefined,
        role: newRole,
      });
      setNewEmail('');
      setNewDisplayName('');
      setNewRole('editor');
    } catch (e: unknown) {
      setAddError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  };

  const handleRoleChange = async (id: string, role: UserRole) => {
    setUpdateErrors((prev) => ({ ...prev, [id]: '' }));
    try {
      await updateUser(id, { role });
    } catch (e: unknown) {
      setUpdateErrors((prev) => ({
        ...prev,
        [id]: e instanceof Error ? e.message : String(e),
      }));
    }
  };

  const handleToggleActive = async (id: string, is_active: boolean) => {
    setUpdateErrors((prev) => ({ ...prev, [id]: '' }));
    try {
      await updateUser(id, { is_active });
    } catch (e: unknown) {
      setUpdateErrors((prev) => ({
        ...prev,
        [id]: e instanceof Error ? e.message : String(e),
      }));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* 새 사용자 추가 */}
      <div className="flex flex-col gap-2">
        <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t('users.add_section')}
        </div>
        <div className="flex flex-col gap-2">
          <input
            className="w-full bg-card border border-border rounded px-2.5 py-1.5 text-foreground text-sm outline-none focus:border-node-user font-sans"
            placeholder={t('users.invite_placeholder')}
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
          <input
            className="w-full bg-card border border-border rounded px-2.5 py-1.5 text-foreground text-sm outline-none focus:border-node-user font-sans"
            placeholder={t('users.display_name_placeholder')}
            value={newDisplayName}
            onChange={(e) => setNewDisplayName(e.target.value)}
          />
          <div className="flex gap-2 items-center">
            <select
              className="bg-card border border-border rounded px-2.5 py-1.5 text-foreground text-sm outline-none focus:border-node-user font-sans"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as UserRole)}
            >
              <option value="admin">admin</option>
              <option value="editor">editor</option>
              <option value="viewer">viewer</option>
            </select>
            <button
              className="bg-node-user text-white border-none rounded px-3 py-1.5 text-sm cursor-pointer font-sans disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleAdd}
              disabled={adding}
            >
              {adding ? t('users.adding') : t('users.invite_btn')}
            </button>
          </div>
          {addError && (
            <div className="text-node-error text-xs">{addError}</div>
          )}
        </div>
      </div>

      {/* 사용자 목록 */}
      <div className="flex flex-col gap-2">
        <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t('users.list_section')}
        </div>
        {loading && <div className="text-muted-foreground text-sm">{t('common.loading')}</div>}
        {!loading && users.length === 0 && (
          <div className="text-muted-foreground text-sm">{t('users.no_users')}</div>
        )}
        <div className="flex flex-col gap-2">
          {users.map((user) => {
            const isSelf = user.email === currentUserEmail;
            return (
              <div
                key={user.id}
                className="flex flex-col gap-1 bg-card border border-border rounded px-3 py-2"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-foreground font-medium flex-1 min-w-0 truncate">
                    {user.display_name ?? user.email}
                  </span>
                  <span className="text-xs text-muted-foreground">{user.email}</span>
                  <span
                    className={`text-xs rounded px-1.5 py-px border ${
                      user.is_active
                        ? 'text-node-response border-node-response/40 bg-node-response/10'
                        : 'text-muted-foreground border-border bg-muted'
                    }`}
                  >
                    {user.is_active ? t('users.active') : t('users.inactive')}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    className="bg-card border border-border rounded px-2 py-0.5 text-foreground text-xs outline-none focus:border-node-user font-sans disabled:opacity-50 disabled:cursor-not-allowed"
                    value={user.role}
                    disabled={isSelf}
                    title={isSelf ? t('users.self_role_tooltip') : undefined}
                    onChange={(e) => handleRoleChange(user.id, e.target.value as UserRole)}
                  >
                    {Object.entries(ROLE_LABELS).map(([r, label]) => (
                      <option key={r} value={r}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="text-xs rounded px-2 py-0.5 border border-border bg-transparent text-muted-foreground cursor-pointer hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed font-sans"
                    disabled={isSelf}
                    title={isSelf ? t('users.self_account_tooltip') : undefined}
                    onClick={() => handleToggleActive(user.id, !user.is_active)}
                  >
                    {user.is_active ? t('users.deactivate') : t('users.activate')}
                  </button>
                </div>
                {updateErrors[user.id] && (
                  <div className="text-node-error text-xs">{updateErrors[user.id]}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
