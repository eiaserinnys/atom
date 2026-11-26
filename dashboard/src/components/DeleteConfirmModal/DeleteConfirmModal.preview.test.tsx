// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import english from '../../locales/en/translation.json';
import korean from '../../locales/ko/translation.json';
import { DeleteConfirmModal, type DeletePreviewState } from './DeleteConfirmModal';

describe('DeleteConfirmModal wording follows the preview', () => {
  let root: Root;
  let container: HTMLDivElement;
  let i18n: ReturnType<typeof i18next.createInstance>;

  async function renderModal(element: ReactNode) {
    await act(async () => {
      root.render(<I18nextProvider i18n={i18n}>{element}</I18nextProvider>);
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }

  function modal(props: { isSymlink?: boolean; preview?: DeletePreviewState }) {
    return <DeleteConfirmModal title="Card" onConfirm={vi.fn()} onClose={vi.fn()} {...props} />;
  }

  function confirmButton() {
    return [...container.querySelectorAll('button')]
      .find(element => element.textContent?.includes(english.delete_modal.confirm_btn))!;
  }

  const sentence = (key: 'body_node' | 'body_link' | 'body_link_last' | 'body_link_unchecked') => english.delete_modal[key].replace('{{name}}', 'Card');

  const permanent = (total: number) => english.delete_modal.cards_permanent.replace('{{total}}', String(total));

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

  test('a symlink whose card sits elsewhere says only the link goes and mentions no permanent deletion', async () => {
    await renderModal(modal({ isSymlink: true, preview: { status: 'ready', deletedCardCount: 0 } }));

    expect(container.textContent).toContain(english.delete_modal.title_link);
    expect(container.textContent).toContain(sentence('body_link'));
    expect(container.textContent).not.toContain(sentence('body_node'));
    expect(container.textContent).not.toContain('permanently');
    expect(container.querySelector('svg')).toBeNull();
    expect(confirmButton().disabled).toBe(false);
  });

  test('the last place of a card says the card is deleted with the link and shows the number', async () => {
    await renderModal(modal({ isSymlink: true, preview: { status: 'ready', deletedCardCount: 1 } }));

    expect(container.querySelector('h2')!.textContent).toBe(english.delete_modal.title_link);
    expect(container.textContent).toContain(sentence('body_link_last'));
    expect(container.textContent).not.toContain(sentence('body_link'));
    expect(container.textContent).toContain(permanent(1));
    expect(container.textContent!.match(/"Card"/g)).toHaveLength(1);
    expect(confirmButton().disabled).toBe(false);
  });

  test('a link with children reuses the node wording for the number of cards', async () => {
    await renderModal(modal({ isSymlink: true, preview: { status: 'ready', deletedCardCount: 3 } }));

    expect(container.textContent).toContain(sentence('body_link_last'));
    expect(container.textContent).toContain(permanent(3));
  });

  test('while a symlink preview loads it says so, claims nothing about the card and locks confirm', async () => {
    await renderModal(modal({ isSymlink: true, preview: { status: 'loading' } }));

    expect(container.textContent).toContain(english.delete_modal.checking);
    expect(container.textContent).toContain(sentence('body_link_unchecked'));
    expect(container.textContent).not.toContain(sentence('body_link'));
    expect(container.textContent).not.toContain('permanently');
    expect(confirmButton().disabled).toBe(true);
  });

  test('when a symlink preview failed it warns the card may go with the last link and opens confirm', async () => {
    await renderModal(modal({ isSymlink: true, preview: { status: 'error' } }));

    expect(container.textContent).toContain(english.delete_modal.cards_unknown_link);
    expect(container.textContent).toContain(sentence('body_link_unchecked'));
    expect(container.textContent).not.toContain(sentence('body_link'));
    expect(confirmButton().disabled).toBe(false);
  });

  test('a node with cards that exist nowhere else shows their number and that it cannot be undone', async () => {
    await renderModal(modal({ preview: { status: 'ready', deletedCardCount: 3 } }));

    expect(container.textContent).toContain(english.delete_modal.title_node);
    expect(container.textContent).toContain(sentence('body_node'));
    expect(container.textContent).toContain(permanent(3));
    expect(container.textContent).not.toContain(english.delete_modal.cards_none);
    expect(confirmButton().disabled).toBe(false);
  });

  test('a node whose cards all sit elsewhere says nothing is deleted permanently', async () => {
    await renderModal(modal({ preview: { status: 'ready', deletedCardCount: 0 } }));

    expect(container.textContent).toContain(english.delete_modal.cards_none);
    expect(container.textContent).not.toContain(permanent(0));
    expect(container.textContent).not.toContain(english.delete_modal.cards_unknown);
  });

  test('while the preview loads it says so and keeps the confirm button locked', async () => {
    await renderModal(modal({ preview: { status: 'loading' } }));

    expect(container.textContent).toContain(english.delete_modal.checking);
    expect(container.textContent).not.toContain('permanently');
    expect(confirmButton().disabled).toBe(true);
  });

  test('when the preview failed it shows the general warning and opens the confirm button', async () => {
    await renderModal(modal({ preview: { status: 'error' } }));

    expect(container.textContent).toContain(english.delete_modal.cards_unknown);
    expect(confirmButton().disabled).toBe(false);
  });

  test('the name sits in the one sentence and nothing asks the question again', async () => {
    await renderModal(modal({ preview: { status: 'ready', deletedCardCount: 1 } }));

    const dialog = container.querySelector('h2')!.parentElement!;
    const texts = [...dialog.children].map(child => child.textContent);
    expect(texts[0]).toBe(english.delete_modal.title_node);
    expect(texts[1]).toBe(sentence('body_node'));
    expect(texts[2]).toBe(permanent(1));
    expect(texts).toHaveLength(4);
    expect(container.textContent!.match(/"Card"/g)).toHaveLength(1);
    expect(Object.keys(english.delete_modal)).not.toContain('desc');
  });

  test('Korean wording is polite and free of the dash and middle dot the style guide bans', () => {
    for (const text of Object.values(korean.delete_modal)) {
      expect(text).not.toMatch(/[―·]/);
    }
    expect(korean.delete_modal.body_node).toBe('"{{name}}" 항목과 그 아래가 모두 삭제됩니다.');
    expect(korean.delete_modal.body_link).toBe('"{{name}}" 링크만 삭제되고 원본 카드는 남습니다.');
    expect(korean.delete_modal.body_link_last).toBe('"{{name}}" 링크는 이 카드가 남은 마지막 자리라서 지우면 카드도 함께 영구 삭제됩니다.');
  });
});
