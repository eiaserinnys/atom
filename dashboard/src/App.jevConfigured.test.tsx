// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import App from './App';

const mocks = vi.hoisted(() => ({ auth: {} as Record<string, unknown>, search: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./api/client', () => ({ api: { search: mocks.search } }));
vi.mock('./hooks/useAuth', async (importOriginal) => ({ ...await importOriginal<typeof import('./hooks/useAuth')>(), useAuth: () => mocks.auth }));
vi.mock('./hooks/useMobile', () => ({ useMobile: () => false }));
vi.mock('./hooks/useTheme', () => ({ useTheme: () => ({ theme: 'dark', toggle: vi.fn() }) }));
vi.mock('./hooks/useAtomEvents', () => ({ useAtomEvents() {} }));
vi.mock('./contexts/SystemProvider', () => ({ SystemProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('./components/RestartBanner', () => ({ RestartBanner: () => null }));
vi.mock('./components/ReconnectOverlay', () => ({ ReconnectOverlay: () => null }));
vi.mock('./components/Config/ConfigModal', () => ({ ConfigModal: () => null }));
vi.mock('./components/Layout/MobileLayout', () => ({ MobileLayout: () => null }));
vi.mock('./pages/LoginPage', () => ({ LoginPage: () => null }));
vi.mock('./components/TreeView/TreeView', () => ({ TreeView: () => null }));
vi.mock('./components/CardDetail/CardDetail', () => ({ CardDetail: () => null }));
vi.mock('./components/CompileView/CompileView', () => ({ CompileView: ({ headerTabs }: { headerTabs: ReactNode }) => <section data-testid="compile">{headerTabs}</section> }));
vi.mock('./components/SearchMotionView/LazySearchMotionView', () => ({ LazySearchMotionView: ({ request }: { request: { query: string } | null }) => <output data-testid="visual">{request?.query}</output> }));
vi.mock('./components/Layout/ThreePanelLayout', () => ({ ThreePanelLayout: ({ center }: { center: ReactNode }) => <>{center}</> }));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
async function open(auth: Record<string, unknown>, search = '') {
  mocks.auth = { authenticated: true, role: 'admin', ...auth };
  window.history.replaceState(null, '', `/${search}`);
  await act(async () => root.render(<App />));
}
const tabs = () => [...new Set([...host.querySelectorAll('[role=tab]')].map(tab => tab.textContent))];
const visual = () => host.querySelector('[data-testid=visual]');
const dropdown = () => host.querySelector('.index-search .absolute');
async function typeAndEnter(text: string) {
  const input = host.querySelector<HTMLInputElement>('.index-search input[type=text]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => host.querySelector('.index-search form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.search.mockReset().mockResolvedValue([{ card_id: 'c1', node_id: 'n1', title: 'Rose result', card_type: 'knowledge', is_symlink: false, snippet: '', node_path: [] }]);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

describe('Jev is not set up (jevConfigured false)', () => {
  test('the center has no Visual search tab', async () => {
    await open({ jevConfigured: false });
    expect(tabs()).toEqual(['compile.header']);
  });

  test('Enter reruns the normal search and keeps the dropdown open instead of going to Visual search', async () => {
    await open({ jevConfigured: false });
    await typeAndEnter('rose');
    expect(mocks.search).toHaveBeenLastCalledWith('rose', expect.anything());
    expect(dropdown()?.textContent).toContain('Rose result');
    expect(visual()).toBeNull();
    expect(host.querySelector('[data-testid=compile]')!.hasAttribute('hidden')).toBe(false);
  });

  test('a ?q= link stays on compile, never mounts Visual search, and opens the normal results for q', async () => {
    await open({ jevConfigured: false }, '?q=rose');
    expect(visual()).toBeNull();
    expect(host.querySelector('[data-testid=compile]')!.parentElement!.hasAttribute('hidden')).toBe(false);
    expect(host.querySelector<HTMLInputElement>('.index-search input[type=text]')!.value).toBe('rose');
    expect(mocks.search).toHaveBeenCalledWith('rose', expect.anything());
    expect(dropdown()?.textContent).toContain('Rose result');
  });
});

describe.each([['true', true], ['missing (older server)', undefined]])('Jev is set up or unknown (jevConfigured %s)', (_label, jevConfigured) => {
  test('both center tabs show and Enter goes to Visual search as before', async () => {
    await open({ jevConfigured });
    expect(tabs()).toEqual(['compile.header', 'visual_search.title']);
    await typeAndEnter('rose');
    expect(visual()?.textContent).toBe('rose');
    expect(mocks.search).not.toHaveBeenCalled();
    expect(dropdown()).toBeNull();
  });

  test('a ?q= link opens Visual search for q and leaves the search box alone', async () => {
    await open({ jevConfigured }, '?q=rose');
    expect(visual()?.textContent).toBe('rose');
    expect(host.querySelector<HTMLInputElement>('.index-search input[type=text]')!.value).toBe('');
    expect(mocks.search).not.toHaveBeenCalled();
  });
});
