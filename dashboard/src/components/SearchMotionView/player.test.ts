// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { createMotionPlayer } from './player.js';
import markup from './motion.html?raw';
import samples from './samples.json';
import type { MotionEvent } from './stream';

function settleFrames(frames: FrameRequestCallback[]) {
  let now = performance.now();
  for (let step = 0; step < 60 && frames.length; step++) {
    now += 16;
    frames.shift()!(now);
  }
}

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
test('skip stays checked while a live stream is arriving and applies the remaining steps', () => {
  const context = new Proxy({}, { get: (_target, key) => key === 'measureText' ? (text: string) => ({ width: text.length * 7 }) : key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as CanvasRenderingContext2D);
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  const host = document.createElement('div'); host.innerHTML = markup; document.body.append(host);
  const player = createMotionPlayer(host, { onSelect: vi.fn(), onResults: vi.fn(), onMore: vi.fn(), onCancel: vi.fn() }, samples);
  try {
    player.begin('실시간 질의');
    const events = samples.atom as unknown as MotionEvent[];
    player.receive(events[0]);
    const skip = host.querySelector<HTMLInputElement>('[data-motion-id=t-skip]')!;
    skip.checked = true; skip.dispatchEvent(new Event('change', { bubbles: true }));
    expect(skip.checked).toBe(true);
    expect(skip.disabled).toBe(false);
    events.slice(1).forEach(event => player.receive(event));
    expect(host.querySelector('[data-motion-id=count]')!.textContent).toBe('13/13');
    expect(skip.checked).toBe(false);
  } finally { player.dispose(); }
});

test('renders approved two-line rows and shows low candidates by default at desktop width', () => {
  const rects: number[][] = [];
  const context = new Proxy({}, { get: (_target, key) => key === 'measureText' ? (text: string) => ({ width: text.length * 7 }) : key === 'rect' ? (...args: number[]) => { rects.push(args); } : key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as CanvasRenderingContext2D);
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1200, 800));
  const host = document.createElement('div'); host.innerHTML = markup; document.body.append(host);
  const player = createMotionPlayer(host, { onSelect: vi.fn(), onResults: vi.fn(), onMore: vi.fn(), onCancel: vi.fn() }, samples);
  try {
    settleFrames(frames);
    expect.soft(host.querySelector<HTMLInputElement>('[data-motion-id=t-low]')!.checked).toBe(true);
    const nodeHeights = rects.filter(([, , width]) => width === 268).map(([, , , height]) => height);
    expect.soft(nodeHeights).toContain(48);
    expect.soft(nodeHeights).not.toContain(30);
  } finally { player.dispose(); }
});

test('selection exposes DOM operations, repeated cards become references, and rewind removes future results', () => {
  const context = new Proxy({}, { get: (_target, key) => key === 'measureText' ? (text: string) => ({ width: text.length * 7 }) : key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as CanvasRenderingContext2D);
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
  HTMLElement.prototype.scrollTo = vi.fn();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1200, 800));
  const host = document.createElement('div'); host.innerHTML = markup; document.body.append(host);
  const operation = vi.fn(); const more = vi.fn();
  const player = createMotionPlayer(host, { onSelect: vi.fn(), onResults: vi.fn(), onMore: more, onCancel: vi.fn(), onOperationRequest: operation }, samples);
  const button = (id: string) => host.querySelector<HTMLButtonElement>(`[data-motion-id=${id}]`)!;
  try {
    player.begin('query');
    (samples.atom as unknown as MotionEvent[]).forEach(event => player.receive(event.event === 'done' ? { ...event, data: { ...event.data, stop_reason: 'exhausted' } } : event));
    const plot = button('plot'); plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    settleFrames(frames);
    expect(button('node-actions').hidden).toBe(false);
    expect(button('node-expand').disabled).toBe(false);
    expect(button('node-evaluate').disabled).toBe(true);
    button('node-expand').click();
    expect(operation).toHaveBeenCalledWith('expand', expect.objectContaining({ selectedCardId: expect.any(String) }));
    const source = player.getSnapshot().selectedCardId!;
    player.applyOperation({ type: 'started', id: 'e', kind: 'expand', fromCardId: source, query: null, viaOperationId: null, requestedCardIds: [] });
    player.applyOperation({ type: 'expansion_succeeded', operationId: 'e', response: { status: 'ready', model: 'text-embedding-3-large', dimensions: 3072, key_configured: true, index: { indexed_cards: 2 }, neighbors: [
      { card_id: source, node_id: 'alias', card_type: 'knowledge', title: 'Repeated', similarity: .8, excerpt: '', path: [], tree_relation: null },
      { card_id: 'new-card', node_id: 'new-node', card_type: 'knowledge', title: 'New card', similarity: .7, excerpt: '', path: [], tree_relation: null },
    ] } });
    player.applyOperation({ type: 'completed', operationId: 'e' });
    expect(button('node-expand').disabled).toBe(true);
    expect(button('node-evaluate').disabled).toBe(false);
    button('more').click();
    expect(more).toHaveBeenCalledWith('query', expect.objectContaining({ continueSearch: false }));
    const scrub = host.querySelector<HTMLInputElement>('[data-motion-id=scrub]')!;
    scrub.value = '13'; scrub.dispatchEvent(new Event('input', { bubbles: true }));
    expect(player.getSnapshot().operations).toHaveLength(0);
    expect(button('node-expand').disabled).toBe(false);
  } finally { player.dispose(); }
});
