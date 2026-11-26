// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import english from '../../locales/en/translation.json';
import korean from '../../locales/ko/translation.json';
import chinese from '../../locales/zh/translation.json';
import french from '../../locales/fr/translation.json';
import german from '../../locales/de/translation.json';
import japanese from '../../locales/ja/translation.json';
import portuguese from '../../locales/pt/translation.json';
import russian from '../../locales/ru/translation.json';
import spanish from '../../locales/es/translation.json';
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

  const sentence = (key: 'body_node' | 'body_link') => english.delete_modal[key].replace('{{name}}', 'Card');

  const permanent = (total: number, links = 0) =>
    (links > 0 ? english.delete_modal.cards_permanent_links : english.delete_modal.cards_permanent)
      .replace('{{total}}', String(total))
      .replace('{{links}}', String(links));

  const ready = (deletedCardCount: number, deletedLinkCount = 0): DeletePreviewState =>
    ({ status: 'ready', deletedCardCount, deletedLinkCount });

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

  test('a symlink says the link is deleted in one sentence in every state', async () => {
    const states: DeletePreviewState[] = [
      { status: 'loading' }, ready(0), ready(1), { status: 'error' },
    ];
    for (const preview of states) {
      await renderModal(modal({ isSymlink: true, preview }));
      const dialog = container.querySelector('h2')!.parentElement!;
      const texts = [...dialog.children].map(child => child.textContent);
      expect(texts[0], preview.status).toBe(english.delete_modal.title_link);
      expect(texts[1], preview.status).toBe(sentence('body_link'));
      expect(texts, preview.status).toHaveLength(4);
      expect(container.textContent!.match(/"Card"/g), preview.status).toHaveLength(1);
    }
  });

  test('a symlink whose card sits elsewhere says the original card stays and nothing is deleted permanently', async () => {
    await renderModal(modal({ isSymlink: true, preview: ready(0) }));

    expect(container.textContent).toContain(english.delete_modal.link_card_stays);
    expect(container.textContent).not.toContain('permanently');
    expect(container.querySelector('svg')).toBeNull();
    expect(confirmButton().disabled).toBe(false);
  });

  test('a symlink that deletes cards shows the node notice with their number and no card-stays line', async () => {
    await renderModal(modal({ isSymlink: true, preview: ready(1) }));

    expect(container.textContent).toContain(permanent(1));
    expect(container.textContent).not.toContain(english.delete_modal.link_card_stays);
    expect(container.textContent!.match(/permanently/g)).toHaveLength(1);
    expect(confirmButton().disabled).toBe(false);

    await renderModal(modal({ isSymlink: true, preview: ready(3) }));
    expect(container.textContent).toContain(permanent(3));
  });

  test('while a symlink preview loads it shows the node checking line and locks confirm', async () => {
    await renderModal(modal({ isSymlink: true, preview: { status: 'loading' } }));

    expect(container.textContent).toContain(english.delete_modal.checking);
    expect(container.textContent).not.toContain('permanently');
    expect(container.textContent).not.toContain(english.delete_modal.link_card_stays);
    expect(confirmButton().disabled).toBe(true);
  });

  test('when a symlink preview failed it warns the card may go with the last link and opens confirm', async () => {
    await renderModal(modal({ isSymlink: true, preview: { status: 'error' } }));

    expect(container.textContent).toContain(english.delete_modal.cards_unknown_link);
    expect(container.textContent).not.toContain(english.delete_modal.link_card_stays);
    expect(confirmButton().disabled).toBe(false);
  });

  test('a node whose cards are deleted shows their number and that it cannot be undone', async () => {
    await renderModal(modal({ preview: ready(3) }));

    expect(container.textContent).toContain(english.delete_modal.title_node);
    expect(container.textContent).toContain(sentence('body_node'));
    expect(container.textContent).toContain(permanent(3));
    expect(container.textContent).not.toContain('Links in other places');
    expect(confirmButton().disabled).toBe(false);
  });

  test('a node whose deleted cards have links in other places shows both numbers in one warning', async () => {
    await renderModal(modal({ preview: ready(2, 3) }));

    expect(container.textContent).toContain(permanent(2, 3));
    expect(container.textContent).toContain('Links in other places deleted with them: 3');
    expect(container.textContent!.match(/permanently/g)).toHaveLength(1);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(confirmButton().disabled).toBe(false);
  });

  test('a symlink that deletes cards with links in other places shows both numbers too', async () => {
    await renderModal(modal({ isSymlink: true, preview: ready(1, 2) }));

    expect(container.textContent).toContain(permanent(1, 2));
    expect(container.textContent).not.toContain(english.delete_modal.link_card_stays);
  });

  test('a node preview without any card (abnormal data) shows no extra line', async () => {
    await renderModal(modal({ preview: ready(0) }));

    const dialog = container.querySelector('h2')!.parentElement!;
    expect([...dialog.children].map(child => child.textContent)).toHaveLength(3);
    expect(container.textContent).not.toContain('permanently');
    expect(container.querySelector('svg')).toBeNull();
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
    expect(english.delete_modal.cards_unknown).toContain('links in other places');
    expect(confirmButton().disabled).toBe(false);
  });

  test('the name sits in the one sentence and nothing asks the question again', async () => {
    await renderModal(modal({ preview: ready(1) }));

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
    expect(korean.delete_modal.body_link).toBe('"{{name}}" 링크가 삭제됩니다.');
    expect(korean.delete_modal.link_card_stays).toBe('원본 카드는 남습니다.');
    expect(korean.delete_modal.cards_permanent).toBe('카드 {{total}}개가 영구 삭제되며 되돌릴 수 없습니다.');
    expect(korean.delete_modal.cards_permanent_links)
      .toBe('카드 {{total}}개가 영구 삭제되고 다른 자리 링크 {{links}}개도 함께 지워집니다. 되돌릴 수 없습니다.');
    expect(korean.delete_modal.cards_unknown).toBe('이 항목과 그 아래의 카드는 다른 자리 링크까지 함께 영구 삭제됩니다.');
    for (const text of Object.values(korean.delete_modal)) {
      expect(text).not.toContain('다른 자리에 없는');
    }
  });

  test('every language has both card-count lines with their numbers and no longer carries cards_none', () => {
    const all = [english, korean, chinese, french, german, japanese, portuguese, russian, spanish];
    for (const language of all) {
      const modalText = language.delete_modal as Record<string, string>;
      expect(modalText.cards_permanent).toContain('{{total}}');
      expect(modalText.cards_permanent).not.toContain('{{links}}');
      expect(modalText.cards_permanent_links).toContain('{{total}}');
      expect(modalText.cards_permanent_links).toContain('{{links}}');
      expect(modalText).not.toHaveProperty('cards_none');
    }
  });

  test('every language has the card-stays line and no longer carries the retired link sentences', () => {
    const all = [english, korean, chinese, french, german, japanese, portuguese, russian, spanish];
    for (const language of all) {
      const modalText = language.delete_modal as Record<string, string>;
      expect(typeof modalText.link_card_stays).toBe('string');
      expect(modalText).not.toHaveProperty('body_link_last');
      expect(modalText).not.toHaveProperty('body_link_unchecked');
      expect(modalText.body_link).not.toBe(modalText.link_card_stays);
    }
  });
});
