// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AuthTab } from './AuthTab';

const configApi = vi.hoisted(() => ({ getEnv: vi.fn(), putEnv: vi.fn() }));
const api = vi.hoisted(() => ({ getAuthProviders: vi.fn() }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../api/client', () => ({ configApi, api }));
vi.mock('../../contexts/systemContext', () => ({ useSystem: () => ({ pendingRestart: false, refreshStatus: vi.fn() }) }));

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const host = document.createElement('div');
document.body.append(host);
let root: Root;

async function render() {
  await act(async () => root.render(<AuthTab />));
  await act(async () => { await Promise.resolve(); });
}

const hasPasswordGroup = () => host.textContent!.includes('auth.password_section');

beforeEach(() => {
  configApi.getEnv.mockResolvedValue({});
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.replaceChildren();
  vi.clearAllMocks();
});

describe('AuthTab admin password group', () => {
  test('is the first group only in password mode', async () => {
    api.getAuthProviders.mockResolvedValue({ google: false, slack: false, password: true });
    await render();
    expect(hasPasswordGroup()).toBe(true);
    expect(host.querySelector('h3')!.textContent).toBe('auth.password_section');
  });

  test.each([
    ['oauth', { google: true, slack: false }],
    ['bypass or unconfigured', { google: false, slack: false }],
    ['password false', { google: false, slack: false, password: false }],
  ])('is absent in %s mode', async (_name, providers) => {
    api.getAuthProviders.mockResolvedValue(providers);
    await render();
    expect(hasPasswordGroup()).toBe(false);
    expect(host.textContent).toContain('auth.google_section');
  });

  test('is absent when the mode cannot be read', async () => {
    api.getAuthProviders.mockRejectedValue(new Error('offline'));
    await render();
    expect(hasPasswordGroup()).toBe(false);
    expect(host.textContent).toContain('auth.google_section');
  });
});
