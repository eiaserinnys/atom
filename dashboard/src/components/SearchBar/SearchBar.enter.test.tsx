// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from '../../api/client';
import { CenterTabs } from '../Layout/CenterTabs';
import { SearchBar } from './SearchBar';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../api/client', () => ({ api: { search: vi.fn() } }));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(api.search).mockReset().mockResolvedValue([{ card_id: 'c1', node_id: 'n1', title: 'Rose result', card_type: 'knowledge', is_symlink: false, snippet: '', node_path: [] }]);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

test('without a Jev handler, Enter reruns the normal search and shows its results', async () => {
  await act(async () => root.render(<SearchBar onSelectNode={vi.fn()} />));
  const input = host.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'rose');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(api.search).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain('Rose result');
});

test('an initial query fills the box and opens its results', async () => {
  await act(async () => root.render(<SearchBar onSelectNode={vi.fn()} initialQuery="rose" />));
  expect(host.querySelector('input')!.value).toBe('rose');
  expect(api.search).toHaveBeenCalledWith('rose', expect.anything());
  expect(host.textContent).toContain('Rose result');
});

test('center tabs omit Visual search when it is turned off', async () => {
  await act(async () => root.render(<CenterTabs mode="compile" onChange={vi.fn()} visualSearch={false} />));
  expect([...host.querySelectorAll('[role=tab]')].map(tab => tab.textContent)).toEqual(['compile.header']);
});
