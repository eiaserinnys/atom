// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, type CardData, type TreeNodeData } from '../../api/client';
import english from '../../locales/en/translation.json';
import { nodeQueryKey } from '../../query/queryKeys';
import { applyAtomEventToCache } from '../../hooks/useAtomEvents';
import { CardDetail } from './CardDetail';

function makeNode(card: CardData): TreeNodeData {
  return {
    id: 'node-1', card_id: card.id, parent_node_id: null, position: 0,
    is_symlink: false, journal_limit: null, created_at: card.updated_at,
    card,
  };
}

function click(element: Element) {
  act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

function setInput(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('CardDetail edit version tracking', () => {
  let root: Root;
  let container: HTMLDivElement;
  let queryClient: QueryClient;
  let currentNode: TreeNodeData;
  let i18n: ReturnType<typeof i18next.createInstance>;

  async function select(nodeId: string) {
    await act(async () => {
      root.render(<StrictMode><I18nextProvider i18n={i18n}><QueryClientProvider client={queryClient}>
        <CardDetail nodeId={nodeId} />
      </QueryClientProvider></I18nextProvider></StrictMode>);
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }

  function cacheSecondCard() {
    const other = { ...currentNode, id: 'node-2', card_id: 'card-2', card: { ...currentNode.card, id: 'card-2', title: 'Other title', content: 'Other body' } };
    queryClient.setQueryData(nodeQueryKey('node-2'), other);
    vi.mocked(api.getNode).mockImplementation(async id => id === 'node-2' ? other : currentNode);
  }

  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const now = '2026-10-26T00:00:00.000Z';
    const card: CardData = {
      id: 'card-1', card_type: 'knowledge', title: 'Original title', content: 'Original body',
      references: [], tags: [], card_timestamp: now, content_timestamp: null, source_type: null,
      source_ref: null, version: 1, updated_at: now, created_by: null, updated_by: null,
    };
    currentNode = makeNode(card);
    vi.spyOn(api, 'getNode').mockImplementation(async () => currentNode);
    vi.stubGlobal('fetch', vi.fn(async () => {
      const updatedCard = { ...currentNode.card, title: 'Saved title', version: 2, updated_at: now };
      currentNode = makeNode(updatedCard);
      return {
        ok: true,
        status: 200,
        json: async () => ({ card: updatedCard, conflict: false }),
      } as Response;
    }));

    queryClient = new QueryClient({
      defaultOptions: { queries: { gcTime: Infinity, retry: false, staleTime: Infinity }, mutations: { gcTime: Infinity, retry: false } },
    });
    queryClient.setQueryData(nodeQueryKey('node-1'), currentNode);
    i18n = i18next.createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: english } }, initAsync: false });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<StrictMode><I18nextProvider i18n={i18n}><QueryClientProvider client={queryClient}>
        <CardDetail nodeId="node-1" />
      </QueryClientProvider></I18nextProvider></StrictMode>);
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test('card switches isolate title, body and journal drafts and restore them on return', async () => {
    cacheSecondCard();
    click(container.querySelector(`[aria-label="${english.card.edit_title}"]`)!);
    setInput(container.querySelector('input')!, 'A title draft');
    click(container.querySelector(`[aria-label="${english.card.edit_content}"]`)!);
    setInput(container.querySelector('textarea')!, 'A body draft');
    const journal = [...container.querySelectorAll('span')].find(el => el.textContent === english.card.journal_limit_all)!;
    click(journal);
    setInput(container.querySelector('input[inputmode="numeric"]')!, '7');

    await select('node-2');
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('input')).toBeNull();
    expect(container.textContent).toContain('Other body');
    click(container.querySelector(`[aria-label="${english.card.edit_content}"]`)!);
    setInput(container.querySelector('textarea')!, 'B body draft');
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ card: { ...currentNode.card, id: 'card-2', content: 'B body draft', version: 2 }, conflict: false }) } as Response);
    await act(async () => {
      click([...container.querySelectorAll('button')].find(el => el.textContent === english.common.save)!);
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(JSON.parse(vi.mocked(fetch).mock.calls.at(-1)![1]!.body as string)).toEqual({ content: 'B body draft', expected_version: 1 });
    expect(vi.mocked(fetch).mock.calls.at(-1)![0]).toBe('/cards/card-2');

    await select('node-1');
    expect(container.querySelector('input')?.value).toBe('A title draft');
    expect(container.querySelector('textarea')?.value).toBe('A body draft');
    expect(container.querySelector<HTMLInputElement>('input[inputmode="numeric"]')?.value).toBe('7');
  });

  test.each(['title', 'content'])('409 preserves the %s draft and warns, then a second save uses current_version', async (field) => {
    click(container.querySelector(`[aria-label="${field === 'title' ? english.card.edit_title : english.card.edit_content}"]`)!);
    const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(field === 'title' ? 'input' : 'textarea')!;
    setInput(input, 'Kept draft');
    const conflict = { error: 'VERSION_CONFLICT', current_version: 4 };
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 409, text: async () => JSON.stringify(conflict) } as Response);
    const save = () => [...container.querySelectorAll('button')].find(button => button.textContent === english.common.save)!;
    await act(async () => {
      click(save());
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(container.querySelector(field === 'title' ? 'input' : 'textarea')).toBe(input);
    expect(input.value).toBe('Kept draft');
    expect(container.textContent).toContain(english.card.unsaved_changes);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({ [field]: 'Kept draft', expected_version: 1 });
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ card: { ...currentNode.card, [field]: 'Kept draft', version: 5 }, conflict: false }) } as Response);
    await act(async () => {
      click(save());
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string)).toEqual({ [field]: 'Kept draft', expected_version: 4 });
    expect(container.querySelector(field === 'title' ? 'input' : 'textarea')).toBeNull();
    expect(container.textContent).not.toContain(english.card.unsaved_changes);
  });

  test('finishing A save after switching to B leaves B editing and its draft unchanged', async () => {
    cacheSecondCard();
    let finishPut!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(resolve => { finishPut = resolve; }));
    click(container.querySelector(`[aria-label="${english.card.edit_title}"]`)!);
    const titleDraft = container.querySelector('input')!;
    setInput(titleDraft, 'Saved A');
    act(() => titleDraft.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await select('node-2');
    click(container.querySelector(`[aria-label="${english.card.edit_title}"]`)!);
    setInput(container.querySelector('input')!, 'Unsaved B');
    await act(async () => {
      finishPut({ ok: true, status: 200, json: async () => ({ card: { ...currentNode.card, title: 'Saved A', version: 2 }, conflict: false }) } as Response);
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(container.querySelector('input')?.value).toBe('Unsaved B');
    await select('node-1');
    expect(container.querySelector('input')).toBeNull();
  });

  test('saving the title while editing the body keeps the body draft without a false conflict', async () => {
    const contentField = container.querySelector(`[aria-label="${english.card.edit_content}"]`)!;
    click(contentField);
    const bodyDraft = container.querySelector('textarea')!;
    setInput(bodyDraft, 'Unsubmitted body draft');

    const titleField = container.querySelector(`[aria-label="${english.card.edit_title}"]`)!;
    click(titleField);
    const titleDraft = container.querySelector('input')!;
    setInput(titleDraft, 'Saved title');
    await act(async () => {
      titleDraft.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('textarea')?.value).toBe('Unsubmitted body draft');
    expect(container.textContent).not.toContain(english.card.unsaved_changes);
    expect([...container.querySelectorAll('button')].some(button => button.textContent === english.card.refresh)).toBe(false);
  });

  test('a PUT response before the cache update never renders a false warning', async () => {
    const savedCard = { ...currentNode.card, title: 'Saved title', version: 2 };
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ card: savedCard, conflict: false }),
    } as Response);
    click(container.querySelector(`[aria-label="${english.card.edit_content}"]`)!);
    setInput(container.querySelector('textarea')!, 'Unsubmitted body draft');
    click(container.querySelector(`[aria-label="${english.card.edit_title}"]`)!);
    const titleDraft = container.querySelector('input')!;
    setInput(titleDraft, 'Saved title');

    const warnings: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.textContent?.includes(english.card.unsaved_changes)) warnings.push(node.textContent);
        }
      }
    });
    observer.observe(container, { childList: true, subtree: true });
    try {
      await act(async () => {
        titleDraft.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(container.querySelector('input')).toBeNull();
      expect(queryClient.getQueryData<TreeNodeData>(nodeQueryKey('node-1'))?.card.version).toBe(1);
      expect(container.textContent).not.toContain(english.card.unsaved_changes);
      await act(async () => {
        currentNode = makeNode(savedCard);
        applyAtomEventToCache(queryClient, { type: 'card:updated', cardId: savedCard.id, data: savedCard, actor: null }, 'node-1');
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(warnings).toEqual([]);
      expect(container.querySelector('textarea')?.value).toBe('Unsubmitted body draft');
    } finally {
      observer.disconnect();
    }
  });

  test('a save response two versions ahead preserves the warning for an intervening external change', async () => {
    const savedCard = { ...currentNode.card, title: 'Saved title', content: 'External body', version: 3 };
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ card: savedCard, conflict: false }),
    } as Response);
    click(container.querySelector(`[aria-label="${english.card.edit_content}"]`)!);
    setInput(container.querySelector('textarea')!, 'Unsubmitted body draft');
    click(container.querySelector(`[aria-label="${english.card.edit_title}"]`)!);
    const titleDraft = container.querySelector('input')!;
    setInput(titleDraft, 'Saved title');
    await act(async () => {
      titleDraft.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector('input')).toBeNull();
    await act(async () => {
      currentNode = makeNode(savedCard);
      applyAtomEventToCache(queryClient, { type: 'card:updated', cardId: savedCard.id, data: savedCard, actor: null }, 'node-1');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector('textarea')?.value).toBe('Unsubmitted body draft');
    expect(container.textContent).toContain(english.card.unsaved_changes);
  });

  test('an SSE update before the PUT response never renders a false warning and later external changes still warn', async () => {
    let finishPut!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => { finishPut = resolve; }));
    click(container.querySelector(`[aria-label="${english.card.edit_content}"]`)!);
    setInput(container.querySelector('textarea')!, 'Unsubmitted body draft');
    click(container.querySelector(`[aria-label="${english.card.edit_title}"]`)!);
    const titleDraft = container.querySelector('input')!;
    setInput(titleDraft, 'Saved title');

    const warnings: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.textContent?.includes(english.card.unsaved_changes)) warnings.push(node.textContent);
        }
      }
    });
    observer.observe(container, { childList: true, subtree: true });
    try {
      act(() => titleDraft.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
      const savedCard = { ...currentNode.card, title: 'Saved title', version: 2 };
      await act(async () => {
        currentNode = makeNode(savedCard);
        applyAtomEventToCache(queryClient, { type: 'card:updated', cardId: savedCard.id, data: savedCard, actor: null }, 'node-1');
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(container.querySelector('button:disabled')).not.toBeNull();
      expect(container.textContent).not.toContain(english.card.unsaved_changes);
      await act(async () => {
        finishPut({ ok: true, status: 200, json: async () => ({ card: savedCard, conflict: false }) } as Response);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(warnings).toEqual([]);
      expect(container.querySelector('textarea')?.value).toBe('Unsubmitted body draft');

      await act(async () => {
        const externalCard = { ...savedCard, content: 'External body', version: 3 };
        currentNode = makeNode(externalCard);
        applyAtomEventToCache(queryClient, { type: 'card:updated', cardId: externalCard.id, data: externalCard, actor: null }, 'node-1');
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(container.textContent).toContain(english.card.unsaved_changes);
      const refresh = [...container.querySelectorAll('button')].find(button => button.textContent === english.card.refresh)!;
      await act(async () => {
        refresh.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(container.querySelector('textarea')).toBeNull();
      expect(container.textContent).toContain('External body');
      expect(container.textContent).not.toContain(english.card.unsaved_changes);
    } finally {
      observer.disconnect();
    }
  });
});
