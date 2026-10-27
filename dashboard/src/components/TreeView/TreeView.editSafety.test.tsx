// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CardData, TreeNodeData } from '../../api/client';
import english from '../../locales/en/translation.json';
import { rootTreeQueryKey } from '../../query/queryKeys';
import { TreeView } from './TreeView';

function makeCard(): CardData {
  return {
    id: 'card-a', card_type: 'knowledge', title: 'A title', content: 'A body',
    references: [], tags: [], card_timestamp: '2026-05-24T00:00:00.000Z',
    content_timestamp: null, source_type: null, source_ref: null,
    version: 1, updated_at: '2026-05-24T00:00:00.000Z', created_by: null, updated_by: null,
  };
}

function makeNode(card = makeCard()): TreeNodeData {
  return {
    id: 'a', card_id: card.id, parent_node_id: null, position: 0,
    is_symlink: false, journal_limit: null, children: [],
    created_at: card.updated_at, card,
  };
}

describe('TreeView edit safety', () => {
  let root: Root;
  let container: HTMLDivElement;
  let client: QueryClient;
  let i18n: ReturnType<typeof i18next.createInstance>;
  let fetchMock: ReturnType<typeof vi.fn>;

  async function settle(action?: () => void) {
    await act(async () => {
      action?.();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }

  function button(text: string) {
    const result = [...document.querySelectorAll('button')].find(item => item.textContent === text);
    expect(result, `button ${text}`).toBeDefined();
    return result!;
  }

  async function openRename() {
    const row = container.querySelector('[data-testid="tree-node-a"] > div')!;
    await settle(() => row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
    await settle(() => button(english.tree.context_rename).click());
  }

  function setTextarea(value: string) {
    const textarea = container.querySelector('textarea')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    client = new QueryClient({
      defaultOptions: { queries: { gcTime: Infinity, staleTime: Infinity, retry: false }, mutations: { gcTime: Infinity, retry: false } },
    });
    client.setQueryData(rootTreeQueryKey(), [makeNode()]);
    i18n = i18next.createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: english } }, initAsync: false });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await settle(() => root.render(
      <StrictMode><I18nextProvider i18n={i18n}><QueryClientProvider client={client}>
        <TreeView selectedNodeId={null} onSelect={vi.fn()} />
      </QueryClientProvider></I18nextProvider></StrictMode>
    ));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    client.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test('sends the opening version, keeps the draft on 409, and does not retry', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 409,
      text: async () => JSON.stringify({ error: 'VERSION_CONFLICT', current_version: 2 }),
    } as Response);
    await openRename();
    const title = container.querySelector('input')!;
    const titleSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await settle(() => {
      titleSetter.call(title, 'Draft title');
      title.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle(() => button(english.common.save).click());

    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
      title: 'Draft title', content: 'A body', expected_version: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector('input')?.value).toBe('Draft title');
    expect(container.querySelector('textarea')?.value).toBe('A body');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(english.card.unsaved_changes);
  });

  test('sends an empty body unchanged and reopening after the saved response shows it empty', async () => {
    const savedCard = { ...makeCard(), content: '', version: 2 };
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ card: savedCard, conflict: false }),
    } as Response);
    await openRename();
    await settle(() => setTextarea(''));
    await settle(() => button(english.common.save).click());

    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
      title: 'A title', content: '', expected_version: 1,
    });
    expect(container.querySelector('textarea')).toBeNull();

    await settle(() => client.setQueryData(rootTreeQueryKey(), [makeNode(savedCard)]));
    expect(client.getQueryData<TreeNodeData[]>(rootTreeQueryKey())?.[0]?.card.content).toBe('');
    await act(async () => root.render(null));
    await settle(() => root.render(
      <StrictMode><I18nextProvider i18n={i18n}><QueryClientProvider client={client}>
        <TreeView selectedNodeId={null} onSelect={vi.fn()} />
      </QueryClientProvider></I18nextProvider></StrictMode>
    ));
    await openRename();
    expect(container.querySelector('textarea')?.value).toBe('');
  });
});
