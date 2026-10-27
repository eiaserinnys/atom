// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CardData } from '../../api/client';
import english from '../../locales/en/translation.json';
import { EditableHeading } from './EditableHeading';

function makeCard(): CardData {
  return {
    id: 'card-a', card_type: 'knowledge', title: 'A title', content: 'A body',
    references: [], tags: [], card_timestamp: '2026-05-24T00:00:00.000Z',
    content_timestamp: null, source_type: null, source_ref: null,
    version: 1, updated_at: '2026-05-24T00:00:00.000Z', created_by: null, updated_by: null,
  };
}

describe('EditableHeading edit safety', () => {
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
    const result = [...container.querySelectorAll('button')].find(item => item.textContent === text);
    expect(result, `button ${text}`).toBeDefined();
    return result!;
  }

  async function openEdit() {
    await settle(() => container.querySelector<HTMLButtonElement>(`button[title="${english.card.edit_title}"]`)!.click());
  }

  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false }, mutations: { gcTime: Infinity, retry: false } } });
    i18n = i18next.createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: english } }, initAsync: false });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const sectionMap = new Map([['node-a', { nodeId: 'node-a', cardId: 'card-a' }]]);
    await settle(() => root.render(
      <StrictMode><I18nextProvider i18n={i18n}><QueryClientProvider client={client}>
        <EditableHeading level={2} sectionMap={sectionMap} compiledNodeId="node-root">
          {['A title ', '<!-- node:node-a card:card-a -->']}
        </EditableHeading>
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

  test('sends the opening version and preserves the draft with the existing conflict warning on 409', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => makeCard() } as Response);
    await openEdit();
    const title = container.querySelector('input')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await settle(() => {
      setter.call(title, 'Draft title');
      title.dispatchEvent(new Event('input', { bubbles: true }));
    });
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 409,
      text: async () => JSON.stringify({ error: 'VERSION_CONFLICT', current_version: 2 }),
    } as Response);
    await settle(() => button(english.common.save).click());

    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({
      title: 'Draft title', content: 'A body', expected_version: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.querySelector('input')?.value).toBe('Draft title');
    expect(container.querySelector('textarea')?.value).toBe('A body');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(english.card.unsaved_changes);
  });

  test('sends an empty body unchanged and reopening after the saved response shows it empty', async () => {
    let serverCard = makeCard();
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        serverCard = { ...serverCard, content: '', version: 2 };
        return { ok: true, status: 200, json: async () => ({ card: serverCard, conflict: false }) } as Response;
      }
      return { ok: true, status: 200, json: async () => serverCard } as Response;
    });
    await openEdit();
    const textarea = container.querySelector('textarea')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await settle(() => {
      setter.call(textarea, '');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle(() => button(english.common.save).click());

    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({
      title: 'A title', content: '', expected_version: 1,
    });
    expect(container.querySelector('textarea')).toBeNull();
    await openEdit();
    expect(container.querySelector('textarea')?.value).toBe('');
  });
});
