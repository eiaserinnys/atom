// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { LoginPage } from './LoginPage';
import ko from '../locales/ko/translation.json';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const host = document.createElement('div');
document.body.append(host);
let root: Root;

async function render() {
  await act(async () => root.render(<LoginPage />));
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => { root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); });

describe('LoginPage when the sign-in options cannot be loaded', () => {
  test('shows the load-failure line when the providers request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await render();
    expect(host.textContent).toContain('login.sign_in_error');
    expect(host.querySelector('form')).toBeNull();
  });

  test('shows the same line when the providers response cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: () => Promise.reject(new SyntaxError('bad json')) }));
    await render();
    expect(host.textContent).toContain('login.sign_in_error');
  });

  test('does not show the line when a provider is available', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ google: false, slack: false, password: true }) }));
    await render();
    expect(host.textContent).not.toContain('login.sign_in_error');
    expect(host.querySelector('form')).not.toBeNull();
  });
});

describe('sign_in_error wording', () => {
  test('says the options could not be loaded, not that authentication is unset', () => {
    expect(ko.login.sign_in_error).toBe('로그인 방법을 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.');
  });
});
