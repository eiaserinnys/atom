// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { SearchMotionView, type SearchMotionViewProps } from './SearchMotionView';
import { createMotionPlayer } from './player.js';
import type { MotionEvent } from './stream';
import samples from './fixtures/samples.json';
import markup from './motion.html?raw';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function environment(width = 1200, height = 800) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const context = new Proxy({}, { get: (_target, key) => key === 'measureText' ? (text: string) => ({ width: text.length * 7 }) : key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as CanvasRenderingContext2D);
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, width, height));
  HTMLElement.prototype.scrollTo = vi.fn();
}
function initial() {
  const host = document.createElement('div'); host.innerHTML = markup; document.body.append(host);
  const player = createMotionPlayer(host, { onSelect: vi.fn(), onResults: vi.fn(), onMore: vi.fn(), onCancel: vi.fn() }, samples);
  player.begin('query');
  return { host, player };
}
function display(host: HTMLElement) {
  return {
    chapters: [...host.querySelectorAll('.seg button')].map(node => node.textContent),
    count: host.querySelector('[data-motion-id=count]')?.textContent,
    zoom: host.querySelector('[data-motion-id=zoom]')?.textContent,
  };
}
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const neighborBody = { status: 'ready' as const, model: 'text-embedding-3-large', dimensions: 3072, key_configured: true,
  index: { indexed_cards: 1 }, neighbors: [{ card_id: 'retry-card', node_id: 'retry-node', card_type: 'knowledge' as const, title: 'Retry candidate', path: [], excerpt: '', similarity: .8, tree_relation: null }] };
const evaluationBody = { evaluation_id: 'retry-evaluation', query: 'query', model: 'jev-latest' as const,
  results: [{ card_id: 'retry-card', node_id: 'retry-node', card_version: 1, score: .99, call_id: 'retry-call', question_key: 'card' }], skipped: [], audit: { calls: [] } };

function failedFixture(query: boolean, evaluation: boolean) {
  const fixture = initial();
  (samples.atom as unknown as MotionEvent[]).forEach(event => fixture.player.receive(event));
  const snapshot = fixture.player.getSnapshot(); const source = snapshot.graphCardIds[0];
  const fromCardId = query ? null : source;
  fixture.player.applyOperation({ type: 'started', id: 'lookup', kind: 'expand', fromCardId, query: query ? 'query' : null, viaOperationId: null, requestedCardIds: [] });
  if (evaluation) {
    fixture.player.applyOperation({ type: 'expansion_succeeded', operationId: 'lookup', response: neighborBody });
    if (!query) {
      fixture.player.applyOperation({ type: 'completed', operationId: 'lookup' });
      fixture.player.applyOperation({ type: 'started', id: 'evaluation', kind: 'evaluate', fromCardId, query: null, viaOperationId: 'lookup', requestedCardIds: ['retry-card'] });
    }
  }
  fixture.player.applyOperation({ type: 'failed', operationId: evaluation && !query ? 'evaluation' : 'lookup', errorCode: 'JEV_UNAVAILABLE' });
  const record = fixture.player.getRecord(); fixture.player.dispose(); fixture.host.remove();
  return { record, source, exclude: snapshot.graphCardIds };
}

test('restored neighbor lookup failures call the original expansion API once and add candidates', async () => {
  environment();
  for (const query of [false, true]) {
    const { record, source, exclude } = failedFixture(query, false);
    const fetch = vi.fn().mockImplementation(async (url: string, _init: RequestInit = {}) => ({ status: 200, json: async () => String(url).endsWith('/search/evaluate') ? evaluationBody : neighborBody }));
    vi.stubGlobal('fetch', fetch);
    const explorationState: NonNullable<SearchMotionViewProps['explorationState']> = { current: { requestId: 7, record } };
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); const results = vi.fn();
    try {
      await act(async () => root.render(<SearchMotionView explorationState={explorationState} request={{ query: 'query', requestId: 7 }} onSelectNode={vi.fn()} onResults={results} />));
      expect(fetch).not.toHaveBeenCalled();
      await act(async () => host.querySelector<HTMLButtonElement>('[role=alert] button')!.click());
      const lookup = fetch.mock.calls.filter(([url]) => !String(url).endsWith('/search/evaluate'));
      expect(lookup).toHaveLength(1);
      if (query) {
        expect(lookup[0][0]).toBe('/search/expand');
        expect(JSON.parse(String(lookup[0][1]?.body))).toEqual({ query: 'query', exclude_card_ids: exclude, limit: 12 });
      } else expect(lookup[0][0]).toBe(`/cards/${source}/neighbors?limit=12`);
      expect(results.mock.calls.some(([nodes]) => nodes.some((node: { cardId: string }) => node.cardId === 'retry-card'))).toBe(true);
    } finally { await act(async () => root.unmount()); host.remove(); }
    expect(explorationState.current!.record.log.entries.at(-1)!.events.at(-1).type).toBe('completed');
  }
});

test('restored evaluation failures call only the evaluation API once', async () => {
  environment();
  for (const query of [false, true]) {
    const { record } = failedFixture(query, true);
    const fetch = vi.fn().mockResolvedValue({ status: 200, json: async () => evaluationBody }); vi.stubGlobal('fetch', fetch);
    const explorationState: NonNullable<SearchMotionViewProps['explorationState']> = { current: { requestId: 7, record } };
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    try {
      await act(async () => root.render(<SearchMotionView explorationState={explorationState} request={{ query: 'query', requestId: 7 }} onSelectNode={vi.fn()} onResults={vi.fn()} />));
      await act(async () => host.querySelector<HTMLButtonElement>('[role=alert] button')!.click());
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0][0]).toBe('/search/evaluate');
      expect(JSON.parse(fetch.mock.calls[0][1].body).card_ids).toEqual(['retry-card']);
    } finally { await act(async () => root.unmount()); host.remove(); }
  }
});

test('completed exploration remount makes zero fetches and keeps chapters, cursor and camera', async () => {
  environment();
  const fixture = initial();
  (samples.atom as unknown as MotionEvent[]).forEach(event => fixture.player.receive(event));
  const source = fixture.player.getSnapshot().graphCardIds[0];
  fixture.player.applyOperation({ type: 'started', id: 'expand-live', kind: 'expand', fromCardId: source, query: null, viaOperationId: null, requestedCardIds: [] });
  fixture.player.applyOperation({ type: 'expansion_succeeded', operationId: 'expand-live', response: { status: 'ready', model: 'text-embedding-3-large', dimensions: 3072, key_configured: true, index: { indexed_cards: 1 }, neighbors: [{ card_id: 'new-card', node_id: 'new-node', card_type: 'knowledge', title: 'New card', path: [], excerpt: '', similarity: .8, tree_relation: null }] } });
  fixture.player.applyOperation({ type: 'completed', operationId: 'expand-live' });
  fixture.player.applyOperation({ type: 'started', id: 'evaluate-live', kind: 'evaluate', fromCardId: source, query: null, viaOperationId: 'expand-live', requestedCardIds: ['new-card'] });
  fixture.player.applyOperation({ type: 'evaluation_batch_succeeded', operationId: 'evaluate-live', response: { evaluation_id: 'eval', query: 'query', model: 'jev-latest', results: [{ card_id: 'new-card', node_id: 'new-node', card_version: 1, score: .9, call_id: 'call', question_key: 'new' }], skipped: [], audit: { calls: [] } } });
  fixture.player.applyOperation({ type: 'completed', operationId: 'evaluate-live' });
  fixture.player.begin('query', { resume: true });
  (samples.atom as unknown as MotionEvent[]).forEach(event => fixture.player.receive(event));
  const scrub = fixture.host.querySelector<HTMLInputElement>('[data-motion-id=scrub]')!;
  scrub.value = '14'; scrub.dispatchEvent(new Event('input', { bubbles: true }));
  fixture.host.querySelector<HTMLButtonElement>('[data-motion-id=t-zout]')!.click();
  const record = fixture.player.getRecord(); const before = display(fixture.host);
  fixture.player.dispose(); fixture.host.remove();
  const fetch = vi.fn().mockRejectedValue(new Error('Restoring must not fetch'));
  vi.stubGlobal('fetch', fetch);
  const explorationState: NonNullable<SearchMotionViewProps['explorationState']> = { current: { requestId: 7, record } };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<SearchMotionView explorationState={explorationState} request={{ query: 'query', requestId: 7 }} onSelectNode={vi.fn()} onResults={vi.fn()} />));
    expect(fetch).not.toHaveBeenCalled();
    expect(display(host)).toEqual(before);
  } finally { await act(async () => root.unmount()); host.remove(); }
  expect(explorationState.current!.record.cursor).toBe(record.cursor);
  expect(explorationState.current!.record.camera).toEqual(record.camera);
  expect(explorationState.current!.record.log).toEqual(record.log);
});

test('an in-flight exploration remount starts a new search with automatic camera fit', async () => {
  environment(390, 400);
  const fixture = initial();
  fixture.player.receive(samples.atom[0] as unknown as MotionEvent);
  fixture.host.querySelector<HTMLButtonElement>('[data-motion-id=t-zout]')!.click();
  const record = fixture.player.getRecord();
  fixture.player.dispose(); fixture.host.remove();
  const fetch = vi.fn().mockImplementation(async (url: string) => {
    if (!String(url).startsWith('/search?')) return { ok: true, json: async () => samples };
    const data = new TextEncoder().encode(samples.atom.map(event => `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`).join(''));
    return { ok: true, body: new ReadableStream({ start(controller) { controller.enqueue(data); controller.close(); } }) };
  });
  vi.stubGlobal('fetch', fetch);
  const explorationState: NonNullable<SearchMotionViewProps['explorationState']> = { current: { requestId: 7, record } };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<SearchMotionView explorationState={explorationState} request={{ query: 'query', requestId: 7 }} onSelectNode={vi.fn()} onResults={vi.fn()} />));
    expect(fetch.mock.calls.filter(([url]) => String(url).startsWith('/search?'))).toHaveLength(1);
    expect(display(host).zoom).toBe('50%');
  } finally { await act(async () => root.unmount()); host.remove(); }
  expect(explorationState.current!.record.camera.z).toBe(.5);
});
