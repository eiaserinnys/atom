// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import english from '../../locales/en/translation.json';
import { TreeView } from './TreeView';

describe('TreeView load error', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  test.each([
    ['an HTML gateway page', 502, '<html><body>502 Bad Gateway</body></html>'],
    ['a JSON body with no readable text', 500, '{"statusCode":500}'],
  ])('shows %s as one plain sentence, not raw JSON or an "API 500:" prefix', async (_name, status, body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status, text: async () => body }));
    const i18n = i18next.createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: english } }, initAsync: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await act(async () => root.render(
      <I18nextProvider i18n={i18n}><QueryClientProvider client={client}>
        <TreeView selectedNodeId={null} onSelect={vi.fn()} />
      </QueryClientProvider></I18nextProvider>
    ));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    expect(container.textContent).toContain(`${english.common.error}: ${english.errors.server}`);
    expect(container.textContent).not.toMatch(/API \d{3}|[{}]|<html/);
    client.clear();
  });
});
