// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, test, expect, vi } from 'vitest';
import { SearchMotionView } from './SearchMotionView';
vi.mock('react-i18next', async () => {
  const { createInstance } = await import('i18next');
  const { default: translation } = await import('../../locales/en/translation.json');
  const i18n = createInstance();
  await i18n.init({ lng: 'en', resources: { en: { translation } } });
  return { useTranslation: () => ({ t: i18n.t, i18n }) };
});
vi.mock('./player.js', () => ({ createMotionPlayer: (host: HTMLElement) => {
  host.querySelector('[data-motion-id=query-title]')!.textContent = 'Playing query';
  return { begin: vi.fn(), receive: vi.fn(), dispose: vi.fn(), error: vi.fn() };
} }));
afterEach(() => { vi.unstubAllGlobals(); });
async function view() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const render = (request: { query: string; requestId: number } | null) => act(async () => root.render(<SearchMotionView request={request} onSelectNode={vi.fn()} onResults={vi.fn()} />));
  const close = async () => { await act(async () => root.unmount()); host.remove(); };
  return { host, render, close };
}
test('idle mounts and hides the player with only a search icon, no fetch; a query reveals the same DOM', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('event: done\ndata: {}\n\n')); c.close(); } }) });
  vi.stubGlobal('fetch', fetch);
  const v = await view();
  try {
    await v.render(null);
    const player = v.host.querySelector<HTMLElement>('.search-motion')!;
    const canvas = player.querySelector('canvas');
    expect(player.hidden).toBe(true);
    expect(v.host.querySelector('[data-search-phase=idle] svg')).not.toBeNull();
    expect(v.host.querySelector('[data-search-phase=idle]')!.textContent).toBe('');
    expect(fetch).not.toHaveBeenCalled();
    await v.render({ query: 'query', requestId: 1 });
    expect(player.hidden).toBe(false);
    expect(v.host.querySelector('canvas')).toBe(canvas);
    expect(player.querySelector('[data-motion-id=query-title]')!.textContent).toBe('Playing query');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(v.host.querySelector('[data-search-phase=idle]')).toBeNull();
  } finally { await v.close(); }
});
test('unconfigured Jev has two lines, no retry, and a new query can start', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: { code: 'JEV_NOT_CONFIGURED' } }) });
  vi.stubGlobal('fetch', fetch);
  const v = await view();
  try {
    await v.render({ query: 'query', requestId: 1 });
    expect([...v.host.querySelectorAll('[data-search-phase=unconfigured] p')].map(p => p.textContent)).toEqual(['Jev search is not set up.', 'Set TYPESAFE_API_KEY and TYPESAFE_BASE_URL on the server.']);
    expect(v.host.querySelector<HTMLElement>('.search-motion')!.hidden).toBe(true);
    expect(v.host.querySelector('[role=alert]')).toBeNull();
    await v.render({ query: 'next', requestId: 2 });
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally { await v.close(); }
});
test.each([[401, 'Sign in again to search.'], [403, "You don't have access to search."], [429, 'Too many searches. Try again shortly.'], [500, 'Search failed.']])('HTTP %s uses translated error and retry', async (status, message) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({}) }));
  const v = await view();
  try {
    await v.render({ query: 'query', requestId: 1 });
    expect(v.host.querySelector('[role=alert]')!.textContent).toBe(`${message} Retry`);
  } finally { await v.close(); }
});
test('interrupted stream uses the translated interruption message', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: new ReadableStream({ start(c) { c.close(); } }) }));
  const v = await view();
  try {
    await v.render({ query: 'query', requestId: 1 });
    expect(v.host.querySelector('[role=alert]')!.textContent).toBe('Connection lost before the search finished. Retry');
  } finally { await v.close(); }
});
test('English motion markup translates text, aria-label, title and graph description without losing inputs', async () => {
  vi.stubGlobal('fetch', vi.fn());
  const v = await view();
  try {
    await v.render(null);
    const first = v.host.querySelector('[data-motion-id=t-first]')!;
    expect(first.getAttribute('aria-label')).toBe('First step');
    expect(first.getAttribute('title')).toBe('First step');
    expect(v.host.querySelector('[data-motion-id=plot]')!.getAttribute('aria-roledescription')).toBe('search graph');
    expect(v.host.querySelector('[data-motion-id=t-skip]')).not.toBeNull();
    expect(v.host.querySelector('.skip')!.textContent).toContain('Skip');
    expect(v.host.innerHTML).not.toMatch(/[가-힣]/);
  } finally { await v.close(); }
});
