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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => key === 'openai.progress'
      ? `${values?.completed} / ${values?.total}`
      : key,
    i18n: { language: 'ko' },
  }),
}));
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
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
    expect(input.placeholder).toBe('openai.configured');

    const remove = [...host.querySelectorAll('button')].find(button => button.textContent === 'common.delete');
    expect(remove).toBeDefined();
    await act(async () => { click(remove!); await Promise.resolve(); await Promise.resolve(); });
    expect(configApi.deleteOpenAIKey).toHaveBeenCalledTimes(1);
    expect(input.placeholder).toBe('openai.not_configured');
  });

  test('uses one key section, a labeled input, a secondary delete button, and a quiet completed state', async () => {
    status = newStatus(true);
    status.embedding.running = false;
    status.embedding.paused_reason = 'no_key';
    status.embedding.completed_cards = 7;
    status.embedding.target_cards = 7;
    await render(<OpenAITab />);

    const input = host.querySelector('input[type="password"]') as HTMLInputElement;
    const label = [...host.querySelectorAll('label')].find(row => row.textContent === 'openai.key');
    expect(input.placeholder).toBe('openai.configured');
    expect(input.id).not.toBe('');
    expect(input.labels).toHaveLength(1);
    expect(label?.htmlFor).toBe(input.id);
    expect([...host.querySelectorAll('h3')].map(row => row.textContent)).toEqual(['openai.embeddings']);
    expect(host.textContent).toContain('7 / 7');
    expect(host.textContent).not.toContain('openai.idle');
    expect(host.textContent).not.toContain('openai.paused_no_key');
    expect(host.textContent).not.toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('100');

    const model = [...host.querySelectorAll('div')].find(row => row.textContent?.trim() === 'text-embedding-3-large');
    expect(model?.className).toContain('text-[13px]');
    expect(model?.className).toContain('text-muted-foreground');

    const remove = [...host.querySelectorAll('button')].find(button => button.textContent === 'common.delete');
    expect(remove?.className).toContain('outline-border');
    expect(remove?.className).toContain('bg-transparent');
    expect(remove?.className).toContain('text-foreground');
    expect(remove?.className).toContain('hover:bg-muted');
  });

  test('shows only a distinct error alongside a pause reason', async () => {
    status = newStatus(true);
    status.embedding.running = false;
    status.embedding.paused_reason = 'auth';
    status.embedding.last_error = { kind: 'OPENAI_AUTH', http_status: 401 };
    await render(<OpenAITab />);
    expect(host.textContent).toContain('openai.paused_auth');
    expect(host.textContent).not.toContain('openai.error_OPENAI_AUTH');

    act(() => root.unmount());
    host.replaceChildren();
    root = createRoot(host);
    status = newStatus(true);
    status.embedding.running = false;
    status.embedding.paused_reason = 'rate_limited';
    status.embedding.last_error = { kind: 'OPENAI_NETWORK', http_status: null };
    await render(<OpenAITab />);
    expect(host.textContent).toContain('openai.paused_rate_limited');
    expect(host.textContent).toContain('openai.error_OPENAI_NETWORK');
  });

  test('shows save success beside the action only after refreshed status arrives', async () => {
    const refreshed = deferred<OpenAIConfigResponse>();
    const saveRequest = deferred<unknown>();
    let reads = 0;
    configApi.getOpenAIConfig.mockImplementation(async () => {
      reads += 1;
      return reads === 1 ? status : refreshed.promise;
    });
    configApi.putOpenAIKey.mockReturnValue(saveRequest.promise);
    await render(<OpenAITab />);

    const input = host.querySelector('input[type="password"]') as HTMLInputElement;
    setInput(input, 'test-only-key');
    const save = [...host.querySelectorAll('button')].find(button => button.textContent === 'common.save')!;
    await act(async () => { click(save); await Promise.resolve(); });
    expect(save.textContent).toBe('common.loading');

    saveRequest.resolve({ key: { configured: true } });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(configApi.getOpenAIConfig).toHaveBeenCalledTimes(2);
    expect(host.textContent).not.toContain('openai.saved');
    expect(save.textContent).toBe('common.loading');

    const nextStatus = newStatus(true);
    refreshed.resolve(nextStatus);
    await act(async () => { await refreshed.promise; });
    expect(input.placeholder).toBe('openai.configured');
    expect(save.textContent).toBe('common.save');
    const notice = [...host.querySelectorAll('*')].find(row => row.childElementCount === 0 && row.textContent === 'openai.saved');
    expect(notice).toBeDefined();
    expect(notice?.parentElement).toBe(save.parentElement);
  });

  test('shows delete progress on delete only and hides saved time after refreshed deletion', async () => {
    status = newStatus(true);
    const refreshed = deferred<OpenAIConfigResponse>();
    const deleteRequest = deferred<unknown>();
    let reads = 0;
    configApi.getOpenAIConfig.mockImplementation(async () => {
      reads += 1;
      return reads === 1 ? status : refreshed.promise;
    });
    configApi.deleteOpenAIKey.mockReturnValue(deleteRequest.promise);
    await render(<OpenAITab />);

    const input = host.querySelector('input[type="password"]') as HTMLInputElement;
    const save = [...host.querySelectorAll('button')].find(button => button.textContent === 'common.save')!;
    const remove = [...host.querySelectorAll('button')].find(button => button.textContent === 'common.delete')!;
    await act(async () => { click(remove); await Promise.resolve(); });
    expect(save.textContent).toBe('common.save');
    expect(remove.textContent).toBe('common.loading');

    status = newStatus(false);
    deleteRequest.resolve({ key: status.key });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(configApi.getOpenAIConfig).toHaveBeenCalledTimes(2);
    expect(remove.textContent).toBe('common.loading');

    refreshed.resolve(status);
    await act(async () => { await refreshed.promise; });
    expect(input.placeholder).toBe('openai.not_configured');
    expect(host.textContent).not.toContain('openai.saved_at');
    expect(host.textContent).toContain('openai.deleted');
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
    expect(input.id).not.toBe('');
    expect(input.labels).toHaveLength(1);
    expect(input.labels?.[0]?.htmlFor).toBe(input.id);
  });
});
