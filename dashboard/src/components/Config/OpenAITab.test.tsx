// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { OpenAIConfigResponse } from '../../../../src/shared/embeddings';
import { ConfigModal } from './ConfigModal';
import { MobileSettingsPage } from './MobileSettingsPage';
import { OpenAITab } from './OpenAITab';
import { AuthTab } from './AuthTab';

const configApi = vi.hoisted(() => ({
  getOpenAIConfig: vi.fn<() => Promise<OpenAIConfigResponse>>(),
  putOpenAIKey: vi.fn<(apiKey: string) => Promise<unknown>>(),
  deleteOpenAIKey: vi.fn<() => Promise<unknown>>(),
  getEnv: vi.fn<() => Promise<Record<string, string>>>(),
  putEnv: vi.fn<() => Promise<unknown>>(),
}));
const systemState = vi.hoisted(() => ({ pendingRestart: false, refreshStatus: vi.fn() }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../api/client', () => ({ configApi }));
vi.mock('../../contexts/systemContext', () => ({ useSystem: () => systemState }));
vi.mock('./UserManagementTab', () => ({ UserManagementTab: () => null }));
vi.mock('./AgentManagementTab', () => ({ AgentManagementTab: () => null }));
vi.mock('./CredentialsTab', () => ({ CredentialsTab: () => null }));
vi.mock('./LanguageTab', () => ({ LanguageTab: () => null }));
vi.mock('./DatabaseTab', () => ({ DatabaseTab: () => null }));

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const host = document.createElement('div');
document.body.append(host);
let root: Root;
let status: OpenAIConfigResponse;

function newStatus(configured = false): OpenAIConfigResponse {
  return {
    key: { configured, last_saved_at: configured ? '2026-10-26T00:00:00.000Z' : null },
    embedding: {
      model: 'text-embedding-3-large', dimensions: 3072, completed_cards: configured ? 3 : 0,
      target_cards: 7, running: configured, paused_reason: configured ? null : 'no_key', last_error: null,
    },
  };
}

async function render(node: ReactNode) {
  await act(async () => root.render(node));
  await act(async () => { await Promise.resolve(); });
}

function click(button: Element) {
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.useRealTimers();
  systemState.pendingRestart = false;
  status = newStatus(false);
  configApi.getOpenAIConfig.mockImplementation(async () => status);
  configApi.putOpenAIKey.mockImplementation(async () => {
    status = newStatus(true);
    return { key: status.key };
  });
  configApi.deleteOpenAIKey.mockImplementation(async () => {
    status = newStatus(false);
    return { key: status.key };
  });
  configApi.getEnv.mockResolvedValue({ GOOGLE_CLIENT_ID: 'client-id' });
  configApi.putEnv.mockResolvedValue({ ok: true });
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.replaceChildren();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('OpenAI settings tab', () => {
  test('is available to admins in desktop and mobile settings and hidden from non-admins', async () => {
    await render(<ConfigModal isOpen onClose={vi.fn()} currentUserRole="admin" currentUserEmail="admin@example.test" />);
    const desktopTab = [...host.querySelectorAll('button')].find(button => button.textContent === 'config.tab_openai');
    expect(desktopTab).toBeDefined();
    click(desktopTab!);
    expect(host.textContent).toContain('openai.embeddings');
    expect(configApi.getOpenAIConfig).toHaveBeenCalled();

    await render(<ConfigModal isOpen onClose={vi.fn()} currentUserRole="viewer" currentUserEmail="viewer@example.test" />);
    expect([...host.querySelectorAll('button')].some(button => button.textContent === 'config.tab_openai')).toBe(false);

    await render(<MobileSettingsPage currentUserRole="admin" currentUserEmail="admin@example.test" />);
    const mobileTab = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('config.tab_openai'));
    expect(mobileTab).toBeDefined();
    click(mobileTab!);
    expect(host.textContent).toContain('openai.embeddings');

    await render(<MobileSettingsPage currentUserRole="viewer" currentUserEmail="viewer@example.test" />);
    expect([...host.querySelectorAll('button')].some(button => button.textContent?.includes('config.tab_openai'))).toBe(false);
  });

  test('saves and deletes through the dedicated API, clears the password field, and refreshes status', async () => {
    await render(<OpenAITab />);
    const input = host.querySelector('input[type="password"]') as HTMLInputElement;
    setInput(input, 'test-only-key');
    const save = [...host.querySelectorAll('button')].find(button => button.textContent === 'common.save');
    expect(save?.hasAttribute('disabled')).toBe(false);
    await act(async () => { click(save!); await Promise.resolve(); await Promise.resolve(); });
    expect(configApi.putOpenAIKey).toHaveBeenCalledTimes(1);
    expect(input.value === '').toBe(true);
    expect(configApi.getOpenAIConfig).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('openai.configured');

    const remove = [...host.querySelectorAll('button')].find(button => button.textContent === 'common.delete');
    expect(remove).toBeDefined();
    await act(async () => { click(remove!); await Promise.resolve(); await Promise.resolve(); });
    expect(configApi.deleteOpenAIKey).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('openai.not_configured');
  });

  test('polls only while mounted and keeps the AuthTab field and button classes unchanged', async () => {
    vi.useFakeTimers();
    await render(<OpenAITab />);
    expect(configApi.getOpenAIConfig).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(configApi.getOpenAIConfig).toHaveBeenCalledTimes(2);
    act(() => root.unmount());
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(configApi.getOpenAIConfig).toHaveBeenCalledTimes(2);
    root = createRoot(host);

    systemState.pendingRestart = true;
    await render(<AuthTab />);
    const input = host.querySelector('input')!;
    const button = host.querySelector('button')!;
    expect(input.className).toBe('w-full px-3 py-1.5 text-sm rounded-none border border-border bg-background text-foreground');
    expect(button.className).toBe('px-4 py-2 text-sm font-medium rounded-none bg-brand text-primary-foreground hover:opacity-90 disabled:opacity-50');
    expect(input.disabled).toBe(true);
    expect(button.disabled).toBe(true);
  });
});
