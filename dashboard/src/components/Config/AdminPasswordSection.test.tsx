// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { PasswordChangeResult } from '../../api/passwordChange';
import { AdminPasswordSection } from './AdminPasswordSection';

const submitPasswordChange = vi.hoisted(() => vi.fn<(current: string, next: string) => Promise<PasswordChangeResult>>());

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../api/passwordChange', () => ({ submitPasswordChange }));

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const host = document.createElement('div');
document.body.append(host);
let root: Root;

async function render() {
  await act(async () => root.render(<AdminPasswordSection />));
  await act(async () => { await Promise.resolve(); });
}

function input(label: string): HTMLInputElement {
  const labelNode = [...host.querySelectorAll('label')].find((node) => node.textContent === label)!;
  return document.getElementById(labelNode.htmlFor) as HTMLInputElement;
}

function type(label: string, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input(label), value);
    input(label).dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit() {
  await act(async () => { host.querySelector('form')!.requestSubmit(); });
}

const message = () => host.querySelector('[aria-live="polite"]')!.textContent;

function fill(current: string, next: string, confirm: string) {
  type('auth.password_current', current);
  type('auth.password_new', next);
  type('auth.password_confirm', confirm);
}

beforeEach(() => {
  submitPasswordChange.mockResolvedValue('ok');
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.replaceChildren();
  vi.clearAllMocks();
});

describe('admin password section', () => {
  test('shows labelled password fields with the right autocomplete values and a live notice area', async () => {
    await render();
    expect(host.querySelector('h3')!.textContent).toBe('auth.password_section');
    expect(input('auth.password_current').autocomplete).toBe('current-password');
    expect(input('auth.password_new').autocomplete).toBe('new-password');
    expect(input('auth.password_confirm').autocomplete).toBe('new-password');
    expect(host.querySelectorAll('input[type="password"]')).toHaveLength(3);
    expect(host.querySelector('button')!.type).toBe('submit');
    expect(host.querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  test('does not send a mismatching confirmation or a short new password', async () => {
    await render();
    fill('old-password', 'new-password-1', 'new-password-2');
    await submit();
    expect(message()).toBe('auth.password_mismatch');
    expect(document.activeElement).toBe(input('auth.password_confirm'));
    fill('old-password', 'short', 'short');
    await submit();
    expect(message()).toBe('auth.password_too_short');
    expect(document.activeElement).toBe(input('auth.password_new'));
    expect(submitPasswordChange).not.toHaveBeenCalled();
  });

  test('locks the fields and button while sending, then clears the fields and confirms', async () => {
    let finish!: (value: PasswordChangeResult) => void;
    submitPasswordChange.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await render();
    fill('old-password', 'new-password-1', 'new-password-1');
    await submit();
    expect(submitPasswordChange).toHaveBeenCalledWith('old-password', 'new-password-1');
    expect([...host.querySelectorAll('input')].every((node) => node.disabled)).toBe(true);
    expect(host.querySelector('button')!.disabled).toBe(true);
    await submit();
    expect(submitPasswordChange).toHaveBeenCalledTimes(1);
    await act(async () => finish('ok'));
    expect([...host.querySelectorAll('input')].map((node) => node.value)).toEqual(['', '', '']);
    expect([...host.querySelectorAll('input')].some((node) => node.disabled)).toBe(false);
    expect(message()).toBe('auth.password_changed');
    expect(document.activeElement).toBe(input('auth.password_current'));
  });

  test.each([
    ['wrong_current', 'auth.password_wrong_current', 'auth.password_current'],
    ['rate_limited', 'auth.password_rate_limited', null],
    ['save_failed', 'auth.password_save_failed', null],
    ['invalid', 'auth.password_invalid', 'auth.password_new'],
  ] as const)('tells a %s failure without raw server text, keeps the typed values and returns focus', async (result, key, focusLabel) => {
    submitPasswordChange.mockResolvedValue(result);
    await render();
    fill('old-password', 'new-password-1', 'new-password-1');
    await submit();
    expect(message()).toBe(key);
    expect(input('auth.password_new').value).toBe('new-password-1');
    expect(input('auth.password_current').disabled).toBe(false);
    expect(document.activeElement).toBe(focusLabel ? input(focusLabel) : host.querySelector('button'));
  });
});
