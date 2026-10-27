// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CardData } from '../../api/client';
import english from '../../locales/en/translation.json';
import { standardCompileNodeQueryKey, standardCompileQueryKey } from '../../query/queryKeys';
import { CompileView } from './CompileView';

function makeCard(overrides: Partial<CardData> = {}): CardData {
  return {
    id: 'card-a', card_type: 'knowledge', title: 'A title', content: 'A body',
    references: [], tags: [], card_timestamp: '2026-05-24T00:00:00.000Z',
    content_timestamp: null, source_type: null, source_ref: null,
    version: 1, updated_at: '2026-05-24T00:00:00.000Z', created_by: null, updated_by: null,
    ...overrides,
  };
}

function compileMarkdown(title: string) {
  return `# ${title} <!-- node:node-a card:card-a -->

Compiled body for ${title}.`;
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe('CompileView edit safety', () => {
  let root: Root;
  let container: HTMLDivElement;
  let client: QueryClient;
  let i18n: ReturnType<typeof i18next.createInstance>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let latestMarkdown: string;
  let latestCards: Record<string, CardData>;
  let putPayloads: Record<string, unknown>[];
  let putCardIds: string[];
  let pendingCardGets: Record<string, (response: Response) => void>;
  let pendingPutResponse: ((response: Response) => void) | null;
  let holdCardGets: boolean;
  let holdNextPut: boolean;
  let conflictOnPut: boolean;

  async function settle(action?: () => unknown) {
    await act(async () => {
      await action?.();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }

  function button(label: string) {
    const result = [...container.querySelectorAll('button')].find(item =>
      item.textContent?.includes(label) || item.title === label
    );
    expect(result, `button ${label}`).toBeDefined();
    return result!;
  }

  function setInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')!.set!;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function openEdit() {
    await settle(() => button(english.card.edit_title).click());
  }

  async function refreshCompile() {
    await settle(() => client.invalidateQueries({ queryKey: standardCompileNodeQueryKey('node-root') }));
  }

  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    latestMarkdown = compileMarkdown('A title');
    latestCards = { 'card-a': makeCard() };
    putPayloads = [];
    putCardIds = [];
    pendingCardGets = {};
    pendingPutResponse = null;
    holdCardGets = false;
    holdNextPut = false;
    conflictOnPut = false;
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin);
      if (url.pathname === '/tree/node-root/compile') {
        return jsonResponse({ markdown: latestMarkdown });
      }
      if (url.pathname.startsWith('/cards/')) {
        const cardId = url.pathname.slice('/cards/'.length);
        if (init?.method === 'PUT') {
          putCardIds.push(cardId);
          putPayloads.push(JSON.parse(init.body as string) as Record<string, unknown>);
          if (holdNextPut) {
            holdNextPut = false;
            return new Promise<Response>(resolve => { pendingPutResponse = resolve; });
          }
          if (conflictOnPut) {
            return {
              ok: false,
              status: 409,
              text: async () => JSON.stringify({ error: 'VERSION_CONFLICT', current_version: latestCards[cardId]!.version }),
            } as Response;
          }
          latestCards[cardId] = makeCard({
            ...latestCards[cardId],
            ...(putPayloads[putPayloads.length - 1] as { title?: string; content?: string }),
            version: latestCards[cardId]!.version + 1,
          });
          return jsonResponse({ card: latestCards[cardId], conflict: false });
        }
        if (holdCardGets) return new Promise<Response>(resolve => { pendingCardGets[cardId] = resolve; });
        return jsonResponse(latestCards[cardId]);
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    client = new QueryClient({
      defaultOptions: { queries: { gcTime: Infinity, staleTime: Infinity, retry: false }, mutations: { gcTime: Infinity, retry: false } },
    });
    client.setQueryData(standardCompileQueryKey('node-root', 5), { markdown: latestMarkdown });
    i18n = i18next.createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: english } }, initAsync: false });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await settle(() => root.render(
      <StrictMode><I18nextProvider i18n={i18n}><QueryClientProvider client={client}>
        <CompileView nodeId="node-root" />
      </QueryClientProvider></I18nextProvider></StrictMode>
    ));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    client.clear();
    localStorage.removeItem('atom-compile-depth');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test('keeps the modal and draft through compile refreshes and a version conflict', async () => {
    await openEdit();
    const title = container.querySelector<HTMLInputElement>('input')!;
    await settle(() => setInputValue(title, 'Draft title'));
    conflictOnPut = true;

    latestCards['card-a'] = makeCard({ title: 'External title v2', content: 'External body v2', version: 2 });
    latestMarkdown = compileMarkdown('External title v2');
    await refreshCompile();

    expect(container.querySelector('h1')?.textContent).toContain('External title v2');
    expect(container.querySelector('textarea')).not.toBeNull();
    expect(container.querySelector<HTMLInputElement>('input')?.value).toBe('Draft title');
    expect(container.querySelector('textarea')?.value).toBe('A body');

    await settle(() => button(english.common.save).click());
    expect(putPayloads[0]).toEqual({ title: 'Draft title', content: 'A body', expected_version: 1 });
    expect(container.querySelector<HTMLInputElement>('input')?.value).toBe('Draft title');
    expect(container.querySelector('textarea')?.value).toBe('A body');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(english.card.unsaved_changes);

    latestMarkdown = compileMarkdown('External title v3');
    await refreshCompile();

    expect(container.querySelector('h1')?.textContent).toContain('External title v3');
    expect(container.querySelector<HTMLInputElement>('input')?.value).toBe('Draft title');
    expect(container.querySelector('textarea')?.value).toBe('A body');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(english.card.unsaved_changes);
  });

  test('sends an empty body unchanged and reopening after the saved response shows it empty', async () => {
    await openEdit();
    const textarea = container.querySelector('textarea')!;
    await settle(() => setInputValue(textarea, ''));
    await settle(() => button(english.common.save).click());

    expect(putPayloads[0]).toEqual({ title: 'A title', content: '', expected_version: 1 });
    expect(container.querySelector('textarea')).toBeNull();

    await openEdit();
    expect(container.querySelector('textarea')?.value).toBe('');
  });

  test('ignores an older card lookup that resolves after a newer edit request', async () => {
    latestCards['card-b'] = makeCard({
      id: 'card-b', title: 'B title', content: 'B body', version: 7,
    });
    latestMarkdown = `# A title <!-- node:node-a card:card-a -->

# B title <!-- node:node-b card:card-b -->`;
    await settle(() => client.setQueryData(standardCompileQueryKey('node-root', 5), { markdown: latestMarkdown }));
    holdCardGets = true;

    const editButtons = () => [...container.querySelectorAll<HTMLButtonElement>(
      `h1 button[title="${english.card.edit_title}"]`
    )];
    expect(editButtons()).toHaveLength(2);
    await settle(() => editButtons()[0]!.click());
    await settle(() => editButtons()[1]!.click());

    expect(pendingCardGets['card-a']).toBeDefined();
    expect(pendingCardGets['card-b']).toBeDefined();
    await settle(() => pendingCardGets['card-b']!(jsonResponse(latestCards['card-b'])));
    expect(container.querySelector<HTMLInputElement>('input')?.value).toBe('B title');

    await settle(() => pendingCardGets['card-a']!(jsonResponse(latestCards['card-a'])));
    expect(container.querySelector<HTMLInputElement>('input')?.value).toBe('B title');
    expect(container.querySelector('textarea')?.value).toBe('B body');

    await settle(() => button(english.common.save).click());
    expect(putCardIds).toEqual(['card-b']);
    expect(putPayloads[0]).toEqual({ title: 'B title', content: 'B body', expected_version: 7 });
  });

  test('an older save response does not close a newer edit modal or discard its draft', async () => {
    latestCards['card-b'] = makeCard({
      id: 'card-b', title: 'B title', content: 'B body', version: 7,
    });
    latestMarkdown = `# A title <!-- node:node-a card:card-a -->

# B title <!-- node:node-b card:card-b -->`;
    await settle(() => client.setQueryData(standardCompileQueryKey('node-root', 5), { markdown: latestMarkdown }));

    const editButtons = () => [...container.querySelectorAll<HTMLButtonElement>(
      `h1 button[title="${english.card.edit_title}"]`
    )];
    await settle(() => editButtons()[0]!.click());
    await settle(() => setInputValue(container.querySelector('input')!, 'A pending save'));
    holdNextPut = true;
    await settle(() => button(english.common.save).click());
    expect(pendingPutResponse).toBeDefined();

    const titleInput = container.querySelector('input')!;
    await settle(() => titleInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(container.querySelector('textarea')).toBeNull();

    await settle(() => editButtons()[1]!.click());
    await settle(() => setInputValue(container.querySelector('input')!, 'B unsaved draft'));
    expect(container.querySelector('input')?.value).toBe('B unsaved draft');

    const savedA = makeCard({ title: 'A pending save', version: 2 });
    latestCards['card-a'] = savedA;
    latestMarkdown = `# A pending save <!-- node:node-a card:card-a -->

# B title <!-- node:node-b card:card-b -->`;
    await settle(() => pendingPutResponse!(jsonResponse({ card: savedA, conflict: false })));
    await refreshCompile();

    expect(container.querySelector('h1')?.textContent).toContain('A pending save');
    expect(container.querySelector('input')?.value).toBe('B unsaved draft');
    expect(container.querySelector('textarea')?.value).toBe('B body');
  });
});
