// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import english from '../../locales/en/translation.json';
import { DeleteConfirmModal } from './DeleteConfirmModal';

describe('DeleteConfirmModal as a keyboard dialog', () => {
  let root: Root;
  let container: HTMLDivElement;
  let i18n: ReturnType<typeof i18next.createInstance>;

  async function renderModal(element: ReactNode) {
    await act(async () => {
      root.render(<I18nextProvider i18n={i18n}>{element}</I18nextProvider>);
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }

  const modal = (props: Partial<React.ComponentProps<typeof DeleteConfirmModal>> = {}) =>
    <DeleteConfirmModal title="Card" onConfirm={vi.fn()} onClose={vi.fn()} {...props} />;

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
    i18n = i18next.createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: english } }, initAsync: false });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  test('opening puts focus on Cancel and Enter there does not delete', async () => {
    const onConfirm = vi.fn();
    await renderModal(modal({ onConfirm }));

    expect(document.activeElement).toBe(button(english.common.cancel));
    press(document.activeElement!, 'Enter');
    expect(onConfirm).not.toHaveBeenCalled();
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

  test('Tab and Shift+Tab cycle between the two buttons', async () => {
    await renderModal(modal());
    const cancel = button(english.common.cancel);
    const confirm = button(english.delete_modal.confirm_btn);

    cancel.focus();
    expect(press(cancel, 'Tab').defaultPrevented).toBe(false);
    confirm.focus();
    expect(press(confirm, 'Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cancel);
    expect(press(cancel, 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(confirm);

    (document.activeElement as HTMLElement).blur();
    press(document.body, 'Tab');
    expect(document.activeElement).toBe(cancel);
    (document.activeElement as HTMLElement).blur();
    press(document.body, 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  test('the box is a modal dialog named by its title, with an id of its own', async () => {
    await renderModal(<>{modal()}{modal({ isSymlink: true })}</>);
    const dialogs = [...container.querySelectorAll('[role="dialog"]')];

    expect(dialogs).toHaveLength(2);
    const ids = dialogs.map(dialog => dialog.getAttribute('aria-labelledby')!);
    expect(new Set(ids).size).toBe(2);
    dialogs.forEach((dialog, index) => {
      expect(dialog.getAttribute('aria-modal')).toBe('true');
      expect(container.ownerDocument.getElementById(ids[index])?.textContent)
        .toBe(index === 0 ? english.delete_modal.title_node : english.delete_modal.title_link);
    });
  });

  test('while deleting, Escape and a click on the backdrop do not close', async () => {
    const onClose = vi.fn();
    await renderModal(modal({ onClose, isLoading: true }));
    const backdrop = container.querySelector('[role="dialog"]')!.parentElement!;

    press(document.body, 'Escape');
    act(() => { backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    expect(onClose).not.toHaveBeenCalled();
  });

  test('when idle, a click on the backdrop still closes', async () => {
    const onClose = vi.fn();
    await renderModal(modal({ onClose }));

    act(() => { container.querySelector('[role="dialog"]')!.parentElement!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
