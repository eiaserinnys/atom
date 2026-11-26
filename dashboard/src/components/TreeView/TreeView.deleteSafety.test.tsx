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

  async function eventually(assertion: () => void) {
    for (let attempt = 0; ; attempt += 1) {
      try { return assertion(); } catch (error) {
        if (attempt >= 100) throw error;
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
      }
    }
  }

  async function clickWhenReady(label: string) {
    await eventually(() => expect(button(label).disabled, `button ${label} disabled`).toBe(false));
    await settle(() => button(label).click());
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
    await settle();
  }

  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    client = new QueryClient({
      defaultOptions: { queries: { gcTime: Infinity, staleTime: Infinity, retry: false }, mutations: { gcTime: Infinity, retry: false } },
    });
    client.setQueryData(rootTreeQueryKey(), [makeNode()]);
    vi.spyOn(api, 'getDeletePreview').mockResolvedValue({
      target: 'node', deleted_node_count: 1, deleted_card_count: 1, deleted_card_ids: ['card-a'], deleted_link_count: 0,
    });
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
    expect(container.textContent).toContain(english.delete_modal.title_node);
    expect(container.textContent).toContain(english.delete_modal.body_node.replace('{{name}}', 'Card to delete'));
  });

  test('confirm click starts one delete and disables a second click while pending', async () => {
    let finishDelete!: () => void;
    const deleteNode = vi.spyOn(api, 'deleteNode').mockImplementation(
      () => new Promise<void>(resolve => { finishDelete = resolve; })
    );
    await openDeleteConfirmation();
    const confirm = button(english.delete_modal.confirm_btn);

    await clickWhenReady(english.delete_modal.confirm_btn);
    expect(confirm.disabled).toBe(true);
    await settle(() => confirm.click());

    expect(deleteNode).toHaveBeenCalledTimes(1);
    expect(deleteNode).toHaveBeenCalledWith('node-a');
    await settle(() => finishDelete());
  });

  test('the preview of the opened node decides the wording and locks confirm until it arrives', async () => {
    let finishPreview!: (preview: Awaited<ReturnType<typeof api.getDeletePreview>>) => void;
    const getDeletePreview = vi.spyOn(api, 'getDeletePreview').mockImplementation(
      () => new Promise(resolve => { finishPreview = resolve; })
    );
    await openDeleteConfirmation();

    expect(getDeletePreview).toHaveBeenCalledWith('node-a');
    expect(container.textContent).toContain(english.delete_modal.checking);
    expect(button(english.delete_modal.confirm_btn).disabled).toBe(true);

    await settle(() => finishPreview({
      target: 'node', deleted_node_count: 3, deleted_card_count: 2, deleted_card_ids: ['card-a', 'card-b'], deleted_link_count: 0,
    }));
    await eventually(() => expect(container.textContent).toContain(
      english.delete_modal.cards_permanent.replace('{{total}}', '2')
    ));
    expect(button(english.delete_modal.confirm_btn).disabled).toBe(false);
  });

  test('a node whose cards have links in other places names both numbers before the user confirms', async () => {
    vi.spyOn(api, 'getDeletePreview').mockResolvedValue({
      target: 'node', deleted_node_count: 5, deleted_card_count: 2, deleted_card_ids: ['card-a', 'card-b'], deleted_link_count: 2,
    });
    await openDeleteConfirmation();

    await eventually(() => expect(container.textContent).toContain(
      english.delete_modal.cards_permanent_links.replace('{{total}}', '2').replace('{{links}}', '2')
    ));
    expect(button(english.delete_modal.confirm_btn).disabled).toBe(false);
  });

  test('a failed preview shows the general warning and still lets the user delete', async () => {
    vi.spyOn(api, 'getDeletePreview').mockRejectedValue(new Error('API 500'));
    const deleteNode = vi.spyOn(api, 'deleteNode').mockResolvedValue(undefined);
    await openDeleteConfirmation();

    await eventually(() => expect(container.textContent).toContain(english.delete_modal.cards_unknown));
    await clickWhenReady(english.delete_modal.confirm_btn);

    expect(deleteNode).toHaveBeenCalledWith('node-a');
  });

  async function openSymlinkDeleteConfirmation() {
    await settle(() => client.setQueryData(rootTreeQueryKey(), [{ ...makeNode(), is_symlink: true }]));
    await openDeleteConfirmation();
  }

  const linkSentence = english.delete_modal.body_link.replace('{{name}}', 'Card to delete');

  test('a symlink node asks for the preview too, locks confirm while it loads and keeps focus on cancel', async () => {
    let finishPreview!: (preview: Awaited<ReturnType<typeof api.getDeletePreview>>) => void;
    const getDeletePreview = vi.spyOn(api, 'getDeletePreview').mockImplementation(
      () => new Promise(resolve => { finishPreview = resolve; })
    );
    await openSymlinkDeleteConfirmation();

    expect(getDeletePreview).toHaveBeenCalledWith('node-a');
    expect(container.textContent).toContain(english.delete_modal.checking);
    expect(container.textContent).toContain(linkSentence);
    expect(button(english.delete_modal.confirm_btn).disabled).toBe(true);
    expect(document.activeElement).toBe(button(english.common.cancel));

    await settle(() => finishPreview({
      target: 'symlink', deleted_node_count: 1, deleted_card_count: 1, deleted_card_ids: ['card-a'], deleted_link_count: 0,
    }));

    await eventually(() => expect(button(english.delete_modal.confirm_btn).disabled).toBe(false));
    expect(container.textContent).toContain(english.delete_modal.title_link);
    expect(container.textContent).toContain(linkSentence);
    expect(container.textContent).toContain(english.delete_modal.cards_permanent.replace('{{total}}', '1'));
  });

  test('a symlink whose card has another place says the original card stays and shows no permanent deletion', async () => {
    vi.spyOn(api, 'getDeletePreview').mockResolvedValue({
      target: 'symlink', deleted_node_count: 1, deleted_card_count: 0, deleted_card_ids: [], deleted_link_count: 0,
    });
    await openSymlinkDeleteConfirmation();

    await eventually(() => expect(container.textContent).toContain(english.delete_modal.link_card_stays));
    expect(container.textContent).toContain(linkSentence);
    expect(container.textContent).not.toContain('permanently');
    expect(button(english.delete_modal.confirm_btn).disabled).toBe(false);
  });

  test('a symlink that only deletes cards below it shows the permanent notice and no card-stays line', async () => {
    vi.spyOn(api, 'getDeletePreview').mockResolvedValue({
      target: 'symlink', deleted_node_count: 2, deleted_card_count: 1, deleted_card_ids: ['card-child'], deleted_link_count: 0,
    });
    await openSymlinkDeleteConfirmation();

    await eventually(() => expect(container.textContent).toContain(
      english.delete_modal.cards_permanent.replace('{{total}}', '1')
    ));
    expect(container.textContent).toContain(linkSentence);
    expect(container.textContent).not.toContain(english.delete_modal.link_card_stays);
  });

  test('a failed symlink preview shows the general warning and still lets the user delete', async () => {
    vi.spyOn(api, 'getDeletePreview').mockRejectedValue(new Error('API 500'));
    const deleteNode = vi.spyOn(api, 'deleteNode').mockResolvedValue(undefined);
    await openSymlinkDeleteConfirmation();

    await eventually(() => expect(container.textContent).toContain(english.delete_modal.cards_unknown_link));
    expect(container.textContent).toContain(linkSentence);
    await clickWhenReady(english.delete_modal.confirm_btn);

    expect(deleteNode).toHaveBeenCalledWith('node-a');
  });
});
