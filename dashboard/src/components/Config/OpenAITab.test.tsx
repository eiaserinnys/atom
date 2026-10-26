// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { OpenAIConfigResponse } from '../../../../src/shared/embeddings';
import { ConfigModal } from './ConfigModal';
import { MobileSettingsPage } from './MobileSettingsPage';
import { OpenAITab } from './OpenAITab';
import { DatabaseTab } from './DatabaseTab';

const configApi = vi.hoisted(() => ({
  getOpenAIConfig: vi.fn<() => Promise<OpenAIConfigResponse>>(),
  putOpenAIKey: vi.fn<(apiKey: string) => Promise<unknown>>(),
  deleteOpenAIKey: vi.fn<() => Promise<unknown>>(),
  getEnv: vi.fn<() => Promise<Record<string, string>>>(),
  putEnv: vi.fn<() => Promise<unknown>>(),
  getDbInfo: vi.fn(),
  testDbConnection: vi.fn(),
}));
const api = vi.hoisted(() => ({ logout: vi.fn() }));
const systemState = vi.hoisted(() => ({ pendingRestart: false, refreshStatus: vi.fn(), triggerRestart: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => key === 'openai.progress'
      ? `${values?.completed} / ${values?.total}`
      : key,
    i18n: { language: 'ko' },
  }),
}));
vi.mock('../../api/client', () => ({ configApi, api }));
vi.mock('../../contexts/systemContext', () => ({ useSystem: () => systemState }));
vi.mock('./UserManagementTab', () => ({ UserManagementTab: () => null }));
vi.mock('./AgentManagementTab', () => ({ AgentManagementTab: () => null }));
vi.mock('./CredentialsTab', () => ({ CredentialsTab: () => null }));
vi.mock('./LanguageTab', () => ({ LanguageTab: () => null }));

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
  configApi.getDbInfo.mockResolvedValue({
    dbType: 'postgres', sqliteFile: '/tmp/atom.db', sqliteFileExists: true, deprecatedFileExists: false,
  });
  api.logout.mockResolvedValue({ ok: true });
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.replaceChildren();
  vi.clearAllMocks();
  vi.restoreAllMocks();
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
    expect([...host.querySelectorAll('nav button')].map(button => button.textContent?.trim())).toEqual([
      'config.tab_language', 'config.tab_credentials', 'app.logout',
    ]);
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
    await render(<ConfigModal isOpen onClose={vi.fn()} currentUserRole="admin" currentUserEmail="admin@example.test" />);
    const authTab = [...host.querySelectorAll('nav button')].find(button => button.textContent === 'config.tab_auth')!;
    click(authTab);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const input = host.querySelector('input')!;
    const button = [...host.querySelectorAll('footer button')].find(row => row.textContent === 'system.restart_now') as HTMLButtonElement;
    expect(input.className).toBe('w-full px-3 py-1.5 text-sm rounded-none border border-border bg-background text-foreground disabled:opacity-50 disabled:cursor-not-allowed');
    expect(button.className).toContain('px-4 py-2 text-sm font-medium rounded-none bg-brand text-primary-foreground');
    expect(input.disabled).toBe(true);
    expect(button.disabled).toBe(false);
    expect(host.querySelector('footer')?.textContent).toContain('system.restart_required');
    click(button);
    expect(systemState.triggerRestart).toHaveBeenCalledOnce();
    expect(input.id).not.toBe('');
    expect(input.labels).toHaveLength(1);
    expect(input.labels?.[0]?.htmlFor).toBe(input.id);
  });
});

describe('settings frame and footer', () => {
  test('keeps the fixed dialog, role-specific tab order, initial focus, and Escape close', async () => {
    const onClose = vi.fn();
    await render(<ConfigModal isOpen onClose={onClose} currentUserRole="admin" currentUserEmail="admin@example.test" />);

    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.className).toContain('max-w-5xl');
    expect(dialog.className).toContain('h-[min(48rem,calc(100dvh-64px))]');
    expect(dialog.parentElement?.className).toContain('bg-black/50');
    expect(dialog.parentElement?.className).toContain('dark:bg-black/70');
    const nav = host.querySelector('nav[aria-label="config.settings"]')!;
    expect([...nav.querySelectorAll('button')].map(button => button.textContent)).toEqual([
      'config.tab_agents', 'config.tab_users', 'config.tab_auth', 'config.tab_openai',
      'config.tab_database', 'config.tab_language', 'config.tab_credentials',
    ]);
    const selected = nav.querySelector('[aria-current="page"]') as HTMLButtonElement;
    expect(selected.textContent).toBe('config.tab_agents');
    expect(document.activeElement).toBe(selected);

    const editor = <ConfigModal isOpen onClose={onClose} currentUserRole="editor" currentUserEmail="editor@example.test" />;
    await render(editor);
    const editorNav = host.querySelector('nav[aria-label="config.settings"]')!;
    expect([...editorNav.querySelectorAll('button')].map(button => button.textContent)).toEqual([
      'config.tab_agents', 'config.tab_language', 'config.tab_credentials',
    ]);

    const active = editorNav.querySelector('[aria-current="page"]')!;
    act(() => active.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(onClose).toHaveBeenCalledOnce();
  });

  test('moves Auth Save into the footer and disables it until loaded values change', async () => {
    await render(<ConfigModal isOpen onClose={vi.fn()} currentUserRole="admin" currentUserEmail="admin@example.test" />);
    const authTab = [...host.querySelectorAll('nav button')].find(button => button.textContent === 'config.tab_auth')!;
    click(authTab);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const footer = host.querySelector('footer')!;
    const save = [...footer.querySelectorAll('button')].find(button => button.textContent === 'auth.save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect([...host.querySelectorAll('section button')].some(button => button.textContent === 'auth.save')).toBe(false);

    setInput(host.querySelector('input') as HTMLInputElement, 'changed-client-id');
    expect(save.disabled).toBe(false);
    await act(async () => { click(save); await Promise.resolve(); await Promise.resolve(); });
    expect(configApi.putEnv).toHaveBeenCalledOnce();
    expect(host.querySelector('footer [aria-live="polite"]')?.textContent).toBe('auth.save_success');
    expect(save.disabled).toBe(true);
  });

  test('shows Restart now instead of Save while restart is pending', async () => {
    systemState.pendingRestart = true;
    await render(<ConfigModal isOpen onClose={vi.fn()} currentUserRole="admin" currentUserEmail="admin@example.test" />);
    const footer = host.querySelector('footer')!;
    expect([...footer.querySelectorAll('button')].map(button => button.textContent)).toEqual([
      'common.close', 'system.restart_now',
    ]);
    expect(footer.textContent).toContain('system.restart_required');
  });

  test('keeps Auth Save enabled when the active tab is selected again', async () => {
    await render(<ConfigModal isOpen onClose={vi.fn()} currentUserRole="admin" currentUserEmail="admin@example.test" />);
    const authTab = [...host.querySelectorAll('nav button')].find(button => button.textContent === 'config.tab_auth')!;
    click(authTab);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const input = host.querySelector('input') as HTMLInputElement;
    const save = [...host.querySelectorAll('footer button')].find(button => button.textContent === 'auth.save') as HTMLButtonElement;
    setInput(input, 'changed-client-id');
    expect(save.disabled).toBe(false);

    click(authTab);
    expect(input.value).toBe('changed-client-id');
    expect(save.disabled).toBe(false);
  });
});

describe('mobile settings navigation', () => {
  test('keeps the list mounted and preserves its scroll position after returning from details', async () => {
    await render(<MobileSettingsPage currentUserRole="admin" currentUserEmail="admin@example.test" />);
    const nav = host.querySelector('nav[aria-label="config.settings"]') as HTMLElement;
    nav.scrollTop = 72;
    const database = [...nav.querySelectorAll('button')].find(button => button.textContent?.includes('config.tab_database'))!;
    click(database);
    expect(nav.hidden).toBe(true);
    expect(host.querySelector('h2')?.textContent).toBe('config.tab_database');

    const back = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('config.settings'))!;
    click(back);
    expect(host.querySelector('nav[aria-label="config.settings"]')).toBe(nav);
    expect(nav.hidden).toBe(false);
    expect(nav.scrollTop).toBe(72);
  });
});

describe('database migration confirmation', () => {
  test('uses an in-app confirmation dialog', async () => {
    await render(<DatabaseTab />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const migrate = [...host.querySelectorAll('button')].find(button => button.textContent === 'database.migration_btn')!;
    click(migrate);
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(host.textContent).toContain('database.migration_confirm');
    expect([...host.querySelectorAll('[role="dialog"] button')].map(button => button.textContent)).toEqual([
      'common.cancel', 'common.confirm',
    ]);
  });

  test('does not migrate when Enter is pressed on Cancel', async () => {
    const fetchRequest = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);
    await render(<DatabaseTab />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const migrate = [...host.querySelectorAll('button')].find(button => button.textContent === 'database.migration_btn')!;
    click(migrate);
    const cancel = [...host.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === 'common.cancel')! as HTMLButtonElement;
    cancel.focus();
    act(() => cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    await act(async () => { await Promise.resolve(); });

    expect(fetchRequest).not.toHaveBeenCalled();
  });

  test('focuses Cancel and keeps settings open when Escape dismisses confirmation', async () => {
    const onClose = vi.fn();
    await render(<ConfigModal isOpen onClose={onClose} currentUserRole="admin" currentUserEmail="admin@example.test" />);
    const databaseTab = [...host.querySelectorAll('nav button')].find(button => button.textContent === 'config.tab_database')!;
    click(databaseTab);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const migrate = [...host.querySelectorAll('button')].find(button => button.textContent === 'database.migration_btn')!;
    click(migrate);
    const confirmation = host.querySelector('[aria-labelledby="database-migration-title"]')!;
    const cancel = [...confirmation.querySelectorAll('button')].find(button => button.textContent === 'common.cancel')! as HTMLButtonElement;
    const cancelHadFocus = document.activeElement === cancel;
    act(() => cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));

    expect(host.querySelector('[role="dialog"][aria-label="config.settings"]')).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-labelledby="database-migration-title"]')).toBeNull();
    expect(cancelHadFocus).toBe(true);
  });
});
