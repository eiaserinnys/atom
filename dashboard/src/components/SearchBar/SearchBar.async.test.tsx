// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, type SearchResult } from '../../api/client';
import { SearchBar } from './SearchBar';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../api/client', () => ({ api: { search: vi.fn() } }));

const initialResult: SearchResult = {
  card_id: 'card-initial',
  node_id: 'node-initial',
  title: 'Initial result',
  card_type: 'knowledge',
  is_symlink: false,
  snippet: '',
  node_path: [],
};

const lateResult: SearchResult = {
  card_id: 'card-late',
  node_id: 'node-late',
  title: 'Late result',
  card_type: 'knowledge',
  is_symlink: false,
  snippet: '',
  node_path: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function resultButton(title: string): HTMLButtonElement | null {
  return [...host.querySelectorAll('button')].find((button) => button.textContent?.includes(title)) ?? null;
}

let host: HTMLDivElement;
let outside: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  outside = document.createElement('div');
  document.body.append(host, outside);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  outside.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

async function changeInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function advanceSearchDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(250);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mountSearchBar() {
  const onSelectNode = vi.fn();
  await act(async () => root.render(<SearchBar onSelectNode={onSelectNode} />));
  return {
    input: host.querySelector<HTMLInputElement>('input[aria-label="searchbar.placeholder"]')!,
    onSelectNode,
  };
}

async function startWithDelayedSecondSearch() {
  const search = vi.mocked(api.search);
  search.mockResolvedValueOnce([initialResult]);
  const ui = await mountSearchBar();

  await changeInput(ui.input, 'first query');
  await advanceSearchDebounce();
  expect(resultButton(initialResult.title)).not.toBeNull();

  const pending = deferred<SearchResult[]>();
  search.mockReturnValueOnce(pending.promise);
  await changeInput(ui.input, 'second query');
  await advanceSearchDebounce();
  expect(search).toHaveBeenCalledTimes(2);

  return { ...ui, pending };
}

describe('stale search responses', () => {
  test.each([
    ['Escape', async (input: HTMLInputElement) => {
      await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    }],
    ['outside click', async (_input: HTMLInputElement) => {
      await act(async () => outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    }],
    ['clearing the query', async (input: HTMLInputElement) => changeInput(input, '')],
    ['selecting a result', async (_input: HTMLInputElement) => {
      await act(async () => resultButton(initialResult.title)!.click());
    }],
  ])('%s keeps a closed result list closed after the response arrives', async (_action, close) => {
    const ui = await startWithDelayedSecondSearch();

    await close(ui.input);
    await act(async () => {
      ui.pending.resolve([lateResult]);
      await ui.pending.promise;
    });

    expect(resultButton(lateResult.title)).toBeNull();
    expect(host.querySelector('form > div.absolute')).toBeNull();
  });

  test('a new query invalidates the older response while its debounce is pending', async () => {
    const ui = await startWithDelayedSecondSearch();
    const latestResult = { ...lateResult, card_id: 'card-latest', node_id: 'node-latest', title: 'Latest result' };
    const latest = deferred<SearchResult[]>();
    vi.mocked(api.search).mockReturnValueOnce(latest.promise);

    await changeInput(ui.input, 'third query');
    await act(async () => {
      ui.pending.resolve([lateResult]);
      await ui.pending.promise;
    });

    expect(resultButton(lateResult.title)).toBeNull();
    expect(resultButton(initialResult.title)).not.toBeNull();

    await advanceSearchDebounce();
    expect(api.search).toHaveBeenCalledTimes(3);
    await act(async () => {
      latest.resolve([latestResult]);
      await latest.promise;
    });

    expect(resultButton(latestResult.title)).not.toBeNull();
  });
});
