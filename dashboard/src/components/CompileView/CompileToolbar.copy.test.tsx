// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { expect, test, vi } from 'vitest';
import english from '../../locales/en/translation.json';
import { CompileToolbar } from './CompileToolbar';

test('copies the existing compile response for each preview mode', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ClipboardItem', undefined);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const fetch = vi.fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ markdown: 'numbered' }) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ markdown: 'unfurl' }) });
  vi.stubGlobal('fetch', fetch);
  const i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', resources: { en: { translation: english } }, initAsync: false });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const view = (unfurlEnabled: boolean) => <I18nextProvider i18n={i18n}><CompileToolbar
    nodeId="node" sliderValue={5} depth={5} depthLabel="5" unfurlEnabled={unfurlEnabled}
    selectDepth={() => {}} onToggleUnfurl={() => {}} onOpenFind={() => {}}
  /></I18nextProvider>;

  await act(async () => root.render(view(false)));
  await act(async () => { host.querySelector<HTMLButtonElement>(`[aria-label="${english.compile.copy_document}"]`)!.click(); await Promise.resolve(); });
  expect(writeText).toHaveBeenLastCalledWith('numbered');
  const standardUrl = new URL(String(fetch.mock.calls[0]![0]), 'http://localhost');
  expect(standardUrl.searchParams.get('numbering')).toBe('true');
  expect(standardUrl.searchParams.get('include_ids')).toBe('true');

  await act(async () => root.render(view(true)));
  await act(async () => { host.querySelector<HTMLButtonElement>(`[aria-label="${english.common.copied}"]`)!.click(); await Promise.resolve(); });
  expect(writeText).toHaveBeenLastCalledWith('unfurl');
  expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({ depth: 5, resolveRefs: 'cached', credentials: {} });
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
