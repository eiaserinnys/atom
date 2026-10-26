// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { SearchBar } from '../SearchBar/SearchBar';
import { MobileTabBar } from '../Layout/MobileTabBar';
import { CenterTabs } from '../Layout/CenterTabs';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../api/client', () => ({ api: { search: vi.fn().mockResolvedValue([]) } }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const host = document.createElement('div');
document.body.append(host);
let root = createRoot(host);
afterEach(() => { act(() => root.unmount()); root = createRoot(host); vi.clearAllMocks(); });
test('search submit dispatches Jev and closes quick results', async () => {
  const submit = vi.fn();
  await act(async () => root.render(<SearchBar onSelectNode={vi.fn()} currentNodeId="root" onSubmitJevSearch={submit} />));
  const input = host.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '장미');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const form = host.querySelector('form');
  expect(form).not.toBeNull();
  await act(async () => form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(submit).toHaveBeenCalledWith('장미', { rootNodeId: undefined });
});
test('mobile navigation exposes search beside compile and detail', async () => {
  const change = vi.fn();
  await act(async () => root.render(<MobileTabBar activeTab="tree" onTabChange={change} showSettings={false} />));
  const search = [...host.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'mobile.tab_search');
  expect(search).toBeDefined();
  expect(search!.textContent).toBe('common.search');
  await act(async () => search!.click());
  expect(change).toHaveBeenCalledWith('search');
});
test('center tab list uses a translated accessible name and keeps its full search label', async () => {
  await act(async () => root.render(<CenterTabs mode="search" onChange={vi.fn()} />));
  expect(host.querySelector('[role=tablist]')!.getAttribute('aria-label')).toBe('visual_search.workspace');
  expect(host.querySelector('[role=tab][aria-selected=true]')!.textContent).toBe('visual_search.title');
});
