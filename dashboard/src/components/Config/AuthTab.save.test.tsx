// @vitest-environment jsdom
import i18next, { type TFunction } from 'i18next';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '../../api/apiError';
import en from '../../locales/en/translation.json';
import { AuthTab, type AuthFooterState } from './AuthTab';

const configApi = vi.hoisted(() => ({ getEnv: vi.fn(), putEnv: vi.fn() }));
const api = vi.hoisted(() => ({ getAuthProviders: vi.fn() }));
const refreshStatus = vi.hoisted(() => vi.fn());
const translator = vi.hoisted(() => ({ t: ((key: string) => key) as unknown }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translator.t }) }));
vi.mock('../../api/client', () => ({ configApi, api }));
vi.mock('../../contexts/systemContext', () => ({ useSystem: () => ({ pendingRestart: false, refreshStatus }) }));

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const host = document.createElement('div');
document.body.append(host);
let root: Root;
let footer: AuthFooterState;

beforeAll(async () => {
  const english = i18next.createInstance();
  await english.init({ lng: 'en', resources: { en: { translation: en } } });
  translator.t = english.t as TFunction;
});

async function render() {
  await act(async () => root.render(<AuthTab onFooterChange={(state) => { footer = state; }} />));
  await act(async () => { await Promise.resolve(); });
}

function field(label: string, nth = 0): HTMLInputElement {
  const labelText = (en.auth as Record<string, string>)[label] ?? label;
  const labels = [...host.querySelectorAll('label')].filter((element) => element.textContent === labelText);
  return document.getElementById(labels[nth]!.htmlFor) as HTMLInputElement;
}

function type(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function save() {
  await act(async () => { await footer.onSave(); });
}

beforeEach(() => {
  configApi.getEnv.mockResolvedValue({ GOOGLE_CLIENT_ID: 'google-id', GOOGLE_CLIENT_SECRET: '***', GOOGLE_CALLBACK_URL: 'https://atom.example/cb' });
  configApi.putEnv.mockResolvedValue({ ok: true });
  api.getAuthProviders.mockResolvedValue({ google: true, slack: false });
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.replaceChildren();
  vi.clearAllMocks();
});

describe('AuthTab saves only what was changed', () => {
  test('sends the one field the user edited and nothing else', async () => {
    await render();
    type(field('allowed_email'), 'admin@example.test');
    await save();

    expect(configApi.putEnv).toHaveBeenCalledWith([{ key: 'ALLOWED_EMAIL', value: 'admin@example.test' }]);
    expect(footer.message).toEqual({ ok: true, text: en.auth.save_success });
    expect(refreshStatus).toHaveBeenCalledTimes(1);
  });

  test('a field the user emptied is sent as empty', async () => {
    await render();
    type(field('client_id'), '');
    await save();

    expect(configApi.putEnv).toHaveBeenCalledWith([{ key: 'GOOGLE_CLIENT_ID', value: '' }]);
  });

  test('a field with no value on screen that the user typed in and cleared again is not sent', async () => {
    await render();
    type(field('allowed_team_id'), 'T1');
    type(field('allowed_team_id'), '');

    expect(footer.disabled).toBe(true);
  });
});

describe('AuthTab shows a refused save as one plain sentence', () => {
  test.each([
    ['no login method', 'no_login_method', [], en.errors.startup_reason.no_login_method],
    ['missing keys', 'missing_keys', ['GOOGLE_CLIENT_SECRET', 'JWT_SECRET'], 'Missing required settings: GOOGLE_CLIENT_SECRET, JWT_SECRET.'],
  ])('a refusal for %s carries one reason sentence, no JSON and no status prefix, and asks for no restart', async (_name, reason, keys, sentence) => {
    configApi.putEnv.mockRejectedValue(new ApiError(400, 'STARTUP_WOULD_FAIL', 'No login method is configured, so the server will not start.', { reason, keys }));
    await render();
    type(field('client_id'), '');
    await save();

    expect(footer.message).toEqual({ ok: false, text: `${en.errors.startup_would_fail} ${sentence}` });
    expect(footer.message!.text).not.toMatch(/[{}]|API \d{3}|will not start/);
    expect(refreshStatus).not.toHaveBeenCalled();
    expect(footer.disabled).toBe(false);
  });

  test('a failed load shows the plain sentence too', async () => {
    configApi.getEnv.mockRejectedValue(new ApiError(500));
    await render();

    expect(footer.message).toEqual({ ok: false, text: en.errors.server });
  });
});
