import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { submitPasswordChange, type PasswordChangeResult } from '../../api/passwordChange';
import { ConfigActionButton, ConfigField } from './ConfigFields';

const MIN_LENGTH = 8;
const MAX_LENGTH = 256;

type Notice = { key: string; ok: boolean } | null;
type FocusTarget = 'current_password' | 'new_password' | 'confirm_password' | 'submit';

const RESULT_FOCUS: Record<Exclude<PasswordChangeResult, 'ok'>, FocusTarget> = {
  wrong_current: 'current_password', invalid: 'new_password', rate_limited: 'submit', save_failed: 'submit',
};

export function AdminPasswordSection() {
  const { t } = useTranslation();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const mounted = useRef(true);
  const form = useRef<HTMLFormElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (submitting || pendingFocus.current === null || !form.current) return;
    const target = pendingFocus.current;
    pendingFocus.current = null;
    const element = target === 'submit' ? form.current.querySelector('button') : form.current.elements.namedItem(target);
    (element as HTMLElement | null)?.focus();
  }, [submitting, notice]);

  const fail = (key: string, target: FocusTarget) => {
    pendingFocus.current = target;
    setNotice({ key, ok: false });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    if (next.length < MIN_LENGTH) return fail('auth.password_too_short', 'new_password');
    if (next !== confirm) return fail('auth.password_mismatch', 'confirm_password');
    setSubmitting(true);
    setNotice(null);
    const result = await submitPasswordChange(current, next);
    if (!mounted.current) return;
    setSubmitting(false);
    if (result === 'ok') {
      setCurrent('');
      setNext('');
      setConfirm('');
      pendingFocus.current = 'current_password';
      setNotice({ key: 'auth.password_changed', ok: true });
    } else {
      fail(`auth.password_${result}`, RESULT_FOCUS[result]);
    }
  };

  const edit = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setNotice(null);
  };

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-foreground">{t('auth.password_section')}</h3>
      <form ref={form} onSubmit={handleSubmit} noValidate>
        <ConfigField label={t('auth.password_current')} name="current_password" type="password" autoComplete="current-password"
          maxLength={MAX_LENGTH} value={current} disabled={submitting} onChange={edit(setCurrent)} />
        <ConfigField label={t('auth.password_new')} name="new_password" type="password" autoComplete="new-password"
          maxLength={MAX_LENGTH} value={next} disabled={submitting} onChange={edit(setNext)} />
        <ConfigField label={t('auth.password_confirm')} name="confirm_password" type="password" autoComplete="new-password"
          maxLength={MAX_LENGTH} value={confirm} disabled={submitting} onChange={edit(setConfirm)} />
        <div className="flex items-center gap-2">
          <ConfigActionButton submit disabled={submitting}>
            {submitting ? t('common.loading') : t('auth.password_submit')}
          </ConfigActionButton>
        </div>
        <p
          aria-live="polite"
          className={notice
            ? `mt-3 text-sm [&:lang(ko)]:break-keep [overflow-wrap:anywhere] ${notice.ok ? 'text-muted-foreground' : 'text-node-error'}`
            : 'sr-only'}
        >
          {notice ? t(notice.key) : ''}
        </p>
      </form>
    </section>
  );
}
