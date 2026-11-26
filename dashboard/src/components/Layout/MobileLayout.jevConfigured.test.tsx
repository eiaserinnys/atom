// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MobileLayout } from './MobileLayout';

const mocks = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../api/client', () => ({ api: { search: mocks.search } }));
vi.mock('../../hooks/useAuth', async (importOriginal) => ({ ...await importOriginal<typeof import('../../hooks/useAuth')>(), useAuth: () => ({ role: 'admin', email: '' }) }));
vi.mock('../TreeView/TreeView', () => ({ TreeView: () => null }));
vi.mock('../CompileView/CompileView', () => ({ CompileView: () => null }));
vi.mock('../Config/MobileSettingsPage', () => ({ MobileSettingsPage: () => null }));
vi.mock('../CardDetail/CardDetail', () => ({ CardDetail: () => null }));
vi.mock('../SearchMotionView/LazySearchMotionView', () => ({ LazySearchMotionView: () => <output data-testid="visual" /> }));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const submitSearch = vi.fn();
const selectedTab = () => host.querySelector('[role=tab][aria-selected=true]')!.textContent;
const dropdown = () => host.querySelector('form .absolute');
async function render(props: { visualSearch?: boolean; request?: { query: string; requestId: number } | null }) {
  await act(async () => root.render(<MobileLayout selectedNodeId={null} onSelectNode={vi.fn()} request={props.request ?? null} searchResults={[]} verdict={null} onSearchSelect={vi.fn()} onSubmitSearch={submitSearch} onResults={vi.fn()} visualSearch={props.visualSearch} />));
}
async function openSearchTabAndEnter() {
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('[role=tab]')][2].click());
  const input = host.querySelector<HTMLInputElement>('form input[type=text]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'rose');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.search.mockReset().mockResolvedValue([{ card_id: 'c1', node_id: 'n1', title: 'Rose result', card_type: 'knowledge', is_symlink: false, snippet: '', node_path: [] }]);
  submitSearch.mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe('Jev is not set up', () => {
  test('the search tab keeps its search box, drops Visual search, and Enter reruns the dropdown search', async () => {
    await render({ visualSearch: false });
    await openSearchTabAndEnter();
    expect(selectedTab()).toBe('common.search');
    expect(host.querySelector('[role=tab][aria-selected=true]')!.hasAttribute('aria-label')).toBe(false);
    expect(host.querySelector('[data-testid=visual]')).toBeNull();
    expect(submitSearch).not.toHaveBeenCalled();
    expect(mocks.search).toHaveBeenLastCalledWith('rose', expect.anything());
    expect(dropdown()?.textContent).toContain('Rose result');
  });

  test('a request in the address does not open the search tab', async () => {
    await render({ visualSearch: false, request: { query: 'rose', requestId: 1 } });
    expect(selectedTab()).toBe('mobile.tab_tree');
    expect(host.querySelector('[data-testid=visual]')).toBeNull();
  });
});

describe.each([['true', true], ['missing (older server)', undefined]])('Jev is set up or unknown (%s)', (_label, visualSearch) => {
  test('Enter hands the query to Visual search and does not open the dropdown', async () => {
    await render({ visualSearch });
    await openSearchTabAndEnter();
    expect(submitSearch).toHaveBeenCalledWith('rose', { rootNodeId: undefined });
    expect(mocks.search).not.toHaveBeenCalled();
    expect(dropdown()).toBeNull();
  });

  test('a request in the address opens the search tab with Visual search', async () => {
    await render({ visualSearch, request: { query: 'rose', requestId: 1 } });
    expect(selectedTab()).toBe('common.search');
    expect(host.querySelector('[data-testid=visual]')).not.toBeNull();
  });
});
