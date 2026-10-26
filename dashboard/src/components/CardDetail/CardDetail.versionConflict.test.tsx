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
    const i18n = i18next.createInstance();
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
