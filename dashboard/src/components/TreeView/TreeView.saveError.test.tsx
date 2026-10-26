// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, type TreeNodeData } from '../../api/client';
import english from '../../locales/en/translation.json';
import { rootTreeQueryKey } from '../../query/queryKeys';
import { TreeView } from './TreeView';

// Reuse the treeViewActions fixture and useAtomEvents real React/jsdom pattern.
// Only the API boundary and time are replaced; the tree, modal and mutation run normally.
function treeNode(id: string): TreeNodeData {
  return {
    id, card_id: `card-${id}`, parent_node_id: null, position: 0,
    is_symlink: false, journal_limit: null, children: [],
    created_at: '2026-05-24T00:00:00.000Z',
    card: {
      id: `card-${id}`, card_type: 'knowledge', title: `${id} title`, content: `${id} content`,
      references: [], tags: [], card_timestamp: '2026-05-24T00:00:00.000Z',
      content_timestamp: null, source_type: null, source_ref: null,
      version: 1, updated_at: '2026-05-24T00:00:00.000Z',
      created_by: null, updated_by: null,
    },
  };
}

describe('TreeView Rename save errors', () => {
  let root: Root;
  let container: HTMLDivElement;
  let client: QueryClient;

  async function settle(action?: () => void) {
    await act(async () => {
      action?.();
      await vi.advanceTimersByTimeAsync(1);
    });
  }

  function button(text: string) {
    const result = [...document.querySelectorAll('button')].find((b) => b.textContent === text);
    expect(result, `button ${text}`).toBeDefined();
    return result!;
  }

  async function rename(id: string) {
    const row = container.querySelector(`[data-testid="tree-node-${id}"] > div`)!;
    await settle(() => row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
    await settle(() => button(english.tree.context_rename).click());
  }

  function input() { return container.querySelector('input')!; }
  function content() { return container.querySelector('textarea')!; }
  function alert() { return container.querySelector('[role="alert"]'); }

  async function enterDraft() {
    await settle(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), 'Draft title');
      input().dispatchEvent(new Event('input', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(content(), 'Retained draft');
      content().dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    client = new QueryClient({
      defaultOptions: { queries: { gcTime: Infinity, staleTime: Infinity }, mutations: { gcTime: Infinity, retry: false } },
    });
    client.setQueryData(rootTreeQueryKey(), [treeNode('a'), treeNode('b')]);
    const i18n = i18next.createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: english } }, initAsync: false });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await settle(() => root.render(
      <StrictMode><I18nextProvider i18n={i18n}><QueryClientProvider client={client}>
        <TreeView selectedNodeId="a" onSelect={vi.fn()} />
      </QueryClientProvider></I18nextProvider></StrictMode>
    ));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    client.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test('reports a rejected save, preserves the draft and clears the error during retry', async () => {
    const update = vi.spyOn(api, 'updateCard').mockRejectedValueOnce(new Error('Card not found'));
    await rename('a');
    expect(alert()).toBeNull();
    await enterDraft();
    await settle(() => button(english.common.save).click());

    expect(update).toHaveBeenCalledWith('card-a', { title: 'Draft title', content: 'Retained draft' });
    expect(alert()?.textContent).toBe(`${english.card.save_failed}: Card not found`);
    expect(alert()?.className).toBe('text-sm text-node-error');
    expect(input().value).toBe('Draft title');
    expect(content().value).toBe('Retained draft');
    expect(button(english.common.save).disabled).toBe(false);
    expect(button(english.common.cancel).disabled).toBe(false);

    let complete!: (value: TreeNodeData['card']) => void;
    update.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    await settle(() => button(english.common.save).click());
    expect(alert()).toBeNull();
    expect(button(english.cardform.saving).disabled).toBe(true);
    expect(button(english.common.cancel).disabled).toBe(true);
    expect(input().value).toBe('Draft title');
    expect(content().value).toBe('Retained draft');
    await settle(() => complete(treeNode('a').card));
    expect(container.querySelector('textarea')).toBeNull();
    expect(update).toHaveBeenCalledTimes(2);
  });

  test('uses the fallback and clears failed edits before same or different card reentry', async () => {
    const update = vi.spyOn(api, 'updateCard').mockRejectedValueOnce(new Error(''));
    await rename('a');
    await settle(() => button(english.common.save).click());
    expect(alert()?.textContent).toBe(english.card.save_failed);
    await settle(() => button(english.common.cancel).click());

    // A create modal must not inherit a failed edit.
    await settle(() => button(english.tree.add_knowledge).click());
    expect(alert()).toBeNull();
    await settle(() => button(english.common.cancel).click());
    await rename('a');
    expect(alert()).toBeNull();
    expect(input().value).toBe('a title');

    update.mockRejectedValueOnce(new Error('Save rejected'));
    await settle(() => button(english.common.save).click());
    expect(alert()?.textContent).toBe(`${english.card.save_failed}: Save rejected`);
    await settle(() => button(english.common.cancel).click());
    await rename('b');
    expect(alert()).toBeNull();
    expect(input().value).toBe('b title');
    expect(content().value).toBe('b content');
    expect(button(english.common.save).disabled).toBe(false);
  });
});
