// @vitest-environment jsdom
import { useState, act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import english from '../../locales/en/translation.json';
import { DeleteConfirmModal } from './DeleteConfirmModal';

function PendingConfirmation({ onConfirm, onClose }: { onConfirm: () => void; onClose: () => void }) {
  const [isLoading, setIsLoading] = useState(false);
  return (
    <DeleteConfirmModal
      title="Card"
      isStructure={false}
      onConfirm={() => { onConfirm(); setIsLoading(true); }}
      onClose={onClose}
      isLoading={isLoading}
    />
  );
}

describe('DeleteConfirmModal keyboard safety', () => {
  let root: Root;
  let container: HTMLDivElement;
  let i18n: ReturnType<typeof i18next.createInstance>;

  async function renderModal(element: ReactNode) {
    await act(async () => {
      root.render(<I18nextProvider i18n={i18n}>{element}</I18nextProvider>);
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }

  function button(label: string) {
    const result = [...container.querySelectorAll('button')].find(element => element.textContent?.includes(label));
    expect(result, `button ${label}`).toBeDefined();
    return result!;
  }

  function keyDown(element: Element, key: string) {
    act(() => element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
  }

  function click(element: Element) {
    act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test('Enter on the focused cancel button does not confirm deletion', async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    await renderModal(<DeleteConfirmModal title="Card" isStructure={false} onConfirm={onConfirm} onClose={onClose} />);

    const cancel = button(english.common.cancel);
    cancel.focus();
    expect(document.activeElement).toBe(cancel);
    keyDown(cancel, 'Enter');

    expect(onConfirm).toHaveBeenCalledTimes(0);
    expect(onClose).toHaveBeenCalledTimes(0);
    expect(document.activeElement).toBe(cancel);
  });

  test('clicking the confirm button calls onConfirm once', async () => {
    const onConfirm = vi.fn();
    await renderModal(<DeleteConfirmModal title="Card" isStructure={false} onConfirm={onConfirm} onClose={vi.fn()} />);

    click(button(english.delete_modal.confirm_btn));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test('a second confirm click is ignored while the request is pending', async () => {
    const onConfirm = vi.fn();
    await renderModal(<PendingConfirmation onConfirm={onConfirm} onClose={vi.fn()} />);
    const confirm = button(english.delete_modal.confirm_btn);

    click(confirm);
    expect(confirm.disabled).toBe(true);
    click(confirm);

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test('Escape still cancels and mounting preserves the existing focus location', async () => {
    const priorFocus = document.createElement('button');
    document.body.append(priorFocus);
    priorFocus.focus();
    const onClose = vi.fn();
    await renderModal(<DeleteConfirmModal title="Card" isStructure={false} onConfirm={vi.fn()} onClose={onClose} />);

    expect(document.activeElement).toBe(priorFocus);
    keyDown(button(english.common.cancel), 'Escape');

    expect(onClose).toHaveBeenCalledTimes(1);
    priorFocus.remove();
  });
});
