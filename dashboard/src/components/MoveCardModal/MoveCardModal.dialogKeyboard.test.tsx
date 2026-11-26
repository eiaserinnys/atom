// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, type TreeNodeData } from '../../api/client';
import english from '../../locales/en/translation.json';
import { MoveCardModal } from './MoveCardModal';

function node(id: string, title: string, type: 'structure' | 'knowledge' = 'structure'): TreeNodeData {
  return {
    id, card_id: `card-${id}`, parent_node_id: null, position: 0, is_symlink: false, journal_limit: null,
    created_at: '2026-05-24T00:00:00.000Z', children: [],
    card: {
      id: `card-${id}`, card_type: type, title, content: '', references: [], tags: [],
      card_timestamp: '2026-05-24T00:00:00.000Z', content_timestamp: null, source_type: null, source_ref: null,
      version: 1, updated_at: '2026-05-24T00:00:00.000Z', created_by: null, updated_by: null,
    },
  };
}

describe('MoveCardModal as a keyboard dialog', () => {
  let root: Root;
  let container: HTMLDivElement;
  let client: QueryClient;
  let i18n: ReturnType<typeof i18next.createInstance>;

  async function renderModal(element: ReactNode) {
    await act(async () => {
      root.render(<I18nextProvider i18n={i18n}><QueryClientProvider client={client}>{element}</QueryClientProvider></I18nextProvider>);
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }

  const modal = (props: Partial<React.ComponentProps<typeof MoveCardModal>> = {}) =>
    <MoveCardModal nodeToMove={node('moving', 'Moving', 'knowledge')} onConfirm={vi.fn()} onClose={vi.fn()} {...props} />;

  function button(label: string) {
    return [...container.querySelectorAll('button')].find(element => element.textContent?.includes(label))!;
  }

  function press(target: Element, key: string, init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    act(() => { target.dispatchEvent(event); });
    return event;
  }

  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.spyOn(api, 'getTree').mockResolvedValue([node('target', 'Target')]);
    vi.spyOn(api, 'listChildren').mockResolvedValue([]);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    i18n = i18next.createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: english } }, initAsync: false });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    client.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test('opening puts focus on Cancel, the first thing to act on (there is no input)', async () => {
    await renderModal(modal());

    expect(container.querySelector('input, textarea')).toBeNull();
    expect(document.activeElement).toBe(button(english.common.cancel));
  });

  test('Escape closes even when focus sits on the page body', async () => {
    const onClose = vi.fn();
    await renderModal(modal({ onClose }));
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);

    press(document.body, 'Escape');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('Escape does not also reach other Escape handlers on the document', async () => {
    const other = vi.fn();
    document.addEventListener('keydown', other);
    const onClose = vi.fn();
    await renderModal(modal({ onClose }));

    press(button(english.common.cancel), 'Escape');
    document.removeEventListener('keydown', other);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  test('Tab and Shift+Tab cycle inside the dialog (folder, Cancel, with Move still locked)', async () => {
    await renderModal(modal());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    const target = button('Target');
    const cancel = button(english.common.cancel);
    expect(button(english.move_modal.confirm_btn).disabled).toBe(true);

    expect(press(cancel, 'Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(target);
    expect(press(target, 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cancel);

    (document.activeElement as HTMLElement).blur();
    press(document.body, 'Tab');
    expect(document.activeElement).toBe(target);
  });

  test('the box is a modal dialog named by its title', async () => {
    await renderModal(modal());
    const dialog = container.querySelector('[role="dialog"]')!;

    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const titleId = dialog.getAttribute('aria-labelledby')!;
    expect(container.ownerDocument.getElementById(titleId)?.textContent).toBe(english.move_modal.title);
  });

  test('while moving, Escape and a click on the backdrop do not close', async () => {
    const onClose = vi.fn();
    await renderModal(modal({ onClose, isLoading: true }));

    press(document.body, 'Escape');
    act(() => { container.querySelector('[role="dialog"]')!.parentElement!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    expect(onClose).not.toHaveBeenCalled();
  });

  test('when idle, a click on the backdrop still closes', async () => {
    const onClose = vi.fn();
    await renderModal(modal({ onClose }));

    act(() => { container.querySelector('[role="dialog"]')!.parentElement!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
