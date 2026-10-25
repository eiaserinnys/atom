// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { SearchBar } from '../SearchBar/SearchBar';
import { MobileTabBar } from '../Layout/MobileTabBar';
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
  const search = [...host.querySelectorAll('button')].find(b => b.textContent?.includes('mobile.tab_search'));
  expect(search).toBeDefined();
  await act(async () => search!.click());
  expect(change).toHaveBeenCalledWith('search');
});
