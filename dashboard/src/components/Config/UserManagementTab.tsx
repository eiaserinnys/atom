import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfig } from '../../hooks/useConfig';
import type { UserRole } from '../../api/client';
import { ConfigActionButton, ConfigField, CONFIG_CONTROL_CLASS } from './ConfigFields';

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
      setAddError(t('users.email_required'));
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
    <div className="space-y-6">
      <section>
        <h3 className="mb-3 text-sm font-semibold text-foreground">
          {t('users.add_section')}
        </h3>
        <ConfigField
          label={t('users.email_label')}
          placeholder={t('users.invite_placeholder')}
          value={newEmail}
          onChange={setNewEmail}
        />
        <ConfigField
          label={t('users.display_name_label')}
          placeholder={t('users.display_name_placeholder')}
          value={newDisplayName}
          onChange={setNewDisplayName}
        />
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col">
            <label htmlFor="new-user-role" className="mb-1 block text-[13px] text-muted-foreground">
              {t('users.role_label')}
            </label>
            <select
              id="new-user-role"
              className={`w-auto h-9 ${CONFIG_CONTROL_CLASS}`}
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as UserRole)}
            >
              <option value="admin">admin</option>
              <option value="editor">editor</option>
              <option value="viewer">viewer</option>
            </select>
          </div>
          <ConfigActionButton onClick={handleAdd} disabled={adding}>
            {adding ? t('users.adding') : t('users.invite_btn')}
          </ConfigActionButton>
        </div>
        {addError && (
          <div className="mt-2 text-node-error text-[13px]">{addError}</div>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-foreground">
          {t('users.list_section')}
        </h3>
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
                className="flex flex-col gap-1 bg-card border border-border rounded-none px-3 py-2"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-foreground font-medium flex-1 min-w-0 truncate">
                    {user.display_name ?? user.email}
                  </span>
                  <span className="text-[13px] text-muted-foreground">{user.email}</span>
                  <span
                    className={`text-[13px] rounded-none px-1.5 py-px border ${
                      user.is_active
                        ? 'text-node-response border-node-response/40 bg-node-response/10'
                        : 'text-muted-foreground border-border bg-muted'
                    }`}
                  >
                    {user.is_active ? t('users.active') : t('users.inactive')}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    id={`user-role-${user.id}`}
                    aria-label={t('users.role_label')}
                    className={`w-auto h-9 ${CONFIG_CONTROL_CLASS}`}
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
                  <ConfigActionButton
                    tone="secondary"
                    disabled={isSelf}
                    title={isSelf ? t('users.self_account_tooltip') : undefined}
                    onClick={() => handleToggleActive(user.id, !user.is_active)}
                  >
                    {user.is_active ? t('users.deactivate') : t('users.activate')}
                  </ConfigActionButton>
                </div>
                {updateErrors[user.id] && (
                  <div className="text-node-error text-[13px]">{updateErrors[user.id]}</div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
