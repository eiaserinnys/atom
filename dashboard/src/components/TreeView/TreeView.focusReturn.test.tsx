// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, type TreeNodeData } from '../../api/client';
import english from '../../locales/en/translation.json';
import { childrenQueryKey, rootTreeQueryKey } from '../../query/queryKeys';
import { TreeView } from './TreeView';

function node(id: string, title: string, type: 'structure' | 'knowledge', parent: string | null, children?: TreeNodeData[]): TreeNodeData {
  return {
    id, card_id: `card-${id}`, parent_node_id: parent, position: 0, is_symlink: false, journal_limit: null,
    created_at: '2026-05-24T00:00:00.000Z', ...(children ? { children } : {}),
    card: {
      id: `card-${id}`, card_type: type, title, content: '', references: [], tags: [],
      card_timestamp: '2026-05-24T00:00:00.000Z', content_timestamp: null, source_type: null, source_ref: null,
      version: 1, updated_at: '2026-05-24T00:00:00.000Z', created_by: null, updated_by: null,
    },
  };
}

const leaf = (parent: string) => node('leaf', 'Leaf', 'knowledge', parent);

describe('TreeView gives focus back after the delete and move dialogs', () => {
  let root: Root;
  let container: HTMLDivElement;
  let client: QueryClient;

  async function settle(action?: () => void) {
    await act(async () => {
      action?.();
      await new Promise(resolve => setTimeout(resolve, 20));
    });
  }

  async function eventually(assertion: () => void) {
    for (let attempt = 0; ; attempt += 1) {
      try { return assertion(); } catch (error) {
        if (attempt >= 100) throw error;
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
      }
    }
  }

  const row = (id: string) => container.querySelector<HTMLElement>(`[data-testid="tree-node-${id}"] > div`)!;
  const list = () => container.querySelector<HTMLElement>('[data-testid="tree-list"]')!;
  const button = (label: string) => [...document.querySelectorAll('button')].find(element => element.textContent?.includes(label))!;

  function setTree(folderChildren: TreeNodeData[], groupChildren: TreeNodeData[]) {
    client.setQueryData(childrenQueryKey('folder'), folderChildren);
    client.setQueryData(childrenQueryKey('group'), groupChildren);
    client.setQueryData(rootTreeQueryKey(), [
      node('folder', 'Folder', 'structure', null, folderChildren),
      node('group', 'Group', 'structure', null, groupChildren),
      node('solo', 'Solo', 'knowledge', null),
    ]);
  }

  async function clickWhenReady(label: string) {
    await eventually(() => {
      const target = button(label);
      expect(target, `button ${label}`).toBeDefined();
      expect((target as HTMLButtonElement).disabled, `button ${label} disabled`).toBe(false);
    });
    await settle(() => button(label).click());
  }

  async function openFromMenu(nodeId: string, label: string) {
    await settle(() => row(nodeId).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
    await clickWhenReady(label);
  }

  function press(key: string) {
    return settle(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
  }

  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    client = new QueryClient({
      defaultOptions: { queries: { gcTime: Infinity, staleTime: Infinity, retry: false }, mutations: { gcTime: Infinity, retry: false } },
    });
    vi.spyOn(api, 'getDeletePreview').mockResolvedValue({ target: 'node', deleted_node_count: 1, deleted_card_count: 1, deleted_card_ids: ['card-leaf'] });
    vi.spyOn(api, 'getTree').mockResolvedValue([node('folder', 'Folder', 'structure', null), node('group', 'Group', 'structure', null)]);
    vi.spyOn(api, 'listChildren').mockResolvedValue([]);
    setTree([leaf('folder')], []);
    const i18n = i18next.createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: english } }, initAsync: false });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await settle(() => root.render(
      <I18nextProvider i18n={i18n}><QueryClientProvider client={client}>
        <TreeView selectedNodeId={null} onSelect={vi.fn()} showLogout={false} />
      </QueryClientProvider></I18nextProvider>
    ));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    client.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test('Escape on the delete dialog returns focus to the row it was opened from', async () => {
    await openFromMenu('leaf', english.tree.context_delete);
    expect(document.activeElement).toBe(button(english.common.cancel));

    await press('Escape');

    expect(container.textContent).not.toContain(english.delete_modal.title_node);
    expect(document.activeElement).toBe(row('leaf'));
  });

  test('Cancel on the move dialog returns focus to the row', async () => {
    await openFromMenu('leaf', english.tree.context_move);
    expect(document.activeElement).toBe(button(english.common.cancel));

    await settle(() => button(english.common.cancel).click());

    expect(document.activeElement).toBe(row('leaf'));
  });

  test('closing the delete dialog after a failed delete returns focus to the row', async () => {
    vi.spyOn(api, 'deleteNode').mockRejectedValue(new Error('API 500'));
    await openFromMenu('leaf', english.tree.context_delete);
    await clickWhenReady(english.delete_modal.confirm_btn);
    await eventually(() => expect(container.textContent).toContain('API 500'));

    await press('Escape');

    expect(document.activeElement).toBe(row('leaf'));
  });

  test('a delete that works sends focus to the parent row', async () => {
    vi.spyOn(api, 'deleteNode').mockResolvedValue(undefined);
    await openFromMenu('leaf', english.tree.context_delete);

    await clickWhenReady(english.delete_modal.confirm_btn);

    await eventually(() => {
      expect(container.textContent).not.toContain(english.delete_modal.title_node);
      expect(document.activeElement).toBe(row('folder'));
    });
  });

  test('a delete that works on a top-level row sends focus to the tree list', async () => {
    vi.spyOn(api, 'deleteNode').mockResolvedValue(undefined);
    await openFromMenu('solo', english.tree.context_delete);

    await clickWhenReady(english.delete_modal.confirm_btn);

    await eventually(() => expect(document.activeElement).toBe(list()));
  });

  async function moveLeafToGroup() {
    vi.spyOn(api, 'moveNode').mockResolvedValue(undefined);
    await openFromMenu('leaf', english.tree.context_move);
    await eventually(() => expect(button('Group')).toBeDefined());
    await settle(() => button('Group').click());
    await settle(() => button(english.move_modal.confirm_btn).click());
  }

  test('a move that works sends focus to the moved row when it shows up', async () => {
    const oldRow = row('leaf');
    await moveLeafToGroup();

    await settle(() => setTree([], [leaf('group')]));

    await eventually(() => {
      expect(oldRow.isConnected).toBe(false);
      expect(document.activeElement).toBe(row('leaf'));
    });
    expect(document.activeElement).not.toBe(oldRow);
  });

  test('a move whose new place is not on screen sends focus to the tree list', async () => {
    await moveLeafToGroup();

    await settle(() => {
      client.setQueryData(childrenQueryKey('folder'), []);
      client.setQueryData(rootTreeQueryKey(), [node('folder', 'Folder', 'structure', null, []), node('solo', 'Solo', 'knowledge', null)]);
    });

    expect(container.querySelector('[data-testid="tree-node-leaf"]')).toBeNull();
    await eventually(() => expect(document.activeElement).toBe(list()));
  });
});
