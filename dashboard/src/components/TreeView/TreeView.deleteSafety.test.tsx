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

function makeNode(): TreeNodeData {
  return {
    id: 'node-a', card_id: 'card-a', parent_node_id: null, position: 0,
    is_symlink: false, journal_limit: null, children: [],
    created_at: '2026-05-24T00:00:00.000Z',
    card: {
      id: 'card-a', card_type: 'knowledge', title: 'Card to delete', content: 'Body',
      references: [], tags: [], card_timestamp: '2026-05-24T00:00:00.000Z',
      content_timestamp: null, source_type: null, source_ref: null,
      version: 1, updated_at: '2026-05-24T00:00:00.000Z', created_by: null, updated_by: null,
    },
  };
}

describe('TreeView delete confirmation safety', () => {
  let root: Root;
  let container: HTMLDivElement;
  let client: QueryClient;

  async function settle(action?: () => void) {
    await act(async () => {
      action?.();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }

  function button(label: string) {
    const result = [...document.querySelectorAll('button')].find(element => element.textContent?.includes(label));
    expect(result, `button ${label}`).toBeDefined();
    return result!;
  }

  async function openDeleteConfirmation() {
    const row = container.querySelector('[data-testid="tree-node-node-a"] > div')!;
    await settle(() => row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
    await settle(() => button(english.tree.context_delete).click());
  }

  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    client = new QueryClient({
      defaultOptions: { queries: { gcTime: Infinity, staleTime: Infinity, retry: false }, mutations: { gcTime: Infinity, retry: false } },
    });
    client.setQueryData(rootTreeQueryKey(), [makeNode()]);
    const i18n = i18next.createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: english } }, initAsync: false });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await settle(() => root.render(
      <StrictMode><I18nextProvider i18n={i18n}><QueryClientProvider client={client}>
        <TreeView selectedNodeId={null} onSelect={vi.fn()} showLogout={false} />
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

  test('Enter on cancel in the actual TreeView delete path does not call deleteNode', async () => {
    const deleteNode = vi.spyOn(api, 'deleteNode').mockResolvedValue(undefined);
    await openDeleteConfirmation();
    const cancel = button(english.common.cancel);
    cancel.focus();

    await settle(() => cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));

    expect(deleteNode).toHaveBeenCalledTimes(0);
    expect(container.textContent).toContain(english.delete_modal.title);
  });

  test('confirm click starts one delete and disables a second click while pending', async () => {
    let finishDelete!: () => void;
    const deleteNode = vi.spyOn(api, 'deleteNode').mockImplementation(
      () => new Promise<void>(resolve => { finishDelete = resolve; })
    );
    await openDeleteConfirmation();
    const confirm = button(english.delete_modal.confirm_btn);

    await settle(() => confirm.click());
    expect(confirm.disabled).toBe(true);
    await settle(() => confirm.click());

    expect(deleteNode).toHaveBeenCalledTimes(1);
    expect(deleteNode).toHaveBeenCalledWith('node-a');
    await settle(() => finishDelete());
  });
});
