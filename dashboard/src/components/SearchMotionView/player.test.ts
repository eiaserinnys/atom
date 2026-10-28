// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { createMotionPlayer } from './player.js';
import markup from './motion.html?raw';
import samples from './fixtures/samples.json';
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

test.each([
  { motion: 'reduced', reduced: true },
  { motion: 'standard', reduced: false },
])('replaying the same search preserves result chips with $motion motion', ({ reduced }) => {
  const context = new Proxy({}, { get: (_target, key) => key === 'measureText' ? (text: string) => ({ width: text.length * 7 }) : key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as CanvasRenderingContext2D);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' && reduced, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  const host = document.createElement('div'); host.innerHTML = markup; document.body.append(host);
  const player = createMotionPlayer(host, { onSelect: vi.fn(), onResults: vi.fn(), onMore: vi.fn(), onCancel: vi.fn() });
  const events = samples.atom as unknown as MotionEvent[];
  const expected = (events.at(-1)!.data as { results: { node_id: string; title: string }[] }).results;
  const replay = () => {
    player.begin('same query');
    events.forEach(event => player.receive(event));
    host.querySelector<HTMLButtonElement>('[data-motion-id=t-last]')!.click();
    return Array.from(host.querySelectorAll<HTMLButtonElement>('.rchip')).map(chip => ({
      nodeId: chip.dataset.nodeId,
      title: chip.querySelector('.rchip-title')?.textContent,
    }));
  };
  try {
    const first = replay();
    expect(first).toHaveLength(expected.length);
    expect(first).toEqual(expected.map(result => ({ nodeId: result.node_id, title: result.title })));
    const second = replay();
    expect(second).toHaveLength(expected.length);
    expect(second).toEqual(first);
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
    // The sample's sufficiency gauge precedes its cards in keyboard order.
    plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    settleFrames(frames);
    expect(player.getSnapshot().selectedCardId).not.toBeNull();
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

test.each(['long', 'shortmore', 'atommore'] as const)('widened %s root is translated for canvas and dashboard, and a wide legend lifts the terminal badge', fixture => {
  const texts: string[] = []; const stamps: number[] = []; let translatedY = 0;
  const context = new Proxy({}, { get: (_target, key) => key === 'measureText' ? (text: string) => ({ width: text.length * 7 })
    : key === 'translate' ? (_x: number, y: number) => { translatedY = y; }
    : key === 'fillText' ? (text: string) => { texts.push(text); if (text === 'Searched all') stamps.push(translatedY); }
    : key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as CanvasRenderingContext2D);
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    return this.matches('.legend') ? new DOMRect(12, 350, 366, 28) : new DOMRect(0, 0, 390, 400);
  });
  HTMLElement.prototype.scrollTo = vi.fn();
  const host = document.createElement('div'); host.innerHTML = markup; document.body.append(host);
  const legend = host.querySelector<HTMLElement>('.legend')!;
  Object.defineProperty(legend, 'offsetHeight', { value: 28 }); legend.style.bottom = '12px';
  const results = vi.fn();
  const player = createMotionPlayer(host, { onSelect: vi.fn(), onResults: results, onMore: vi.fn(), onCancel: vi.fn(),
    translate: key => ({ 'visual_search.root': 'Root', 'visual_search.stop_exhausted': 'Searched all' } as Record<string, string>)[key] ?? key });
  try {
    player.begin('query');
    const events = samples[fixture] as unknown as MotionEvent[];
    const widened = events.findIndex(event => event.event === 'step_completed' && (event.data.step as { stage: string }).stage === 'widen');
    events.slice(0, widened + 1).forEach(event => player.receive(event));
    settleFrames(frames);
    expect(texts).toContain('Root');
    events.slice(widened + 1).forEach(event => player.receive(event));
    settleFrames(frames);
    const root = results.mock.calls.flatMap(([nodes]) => nodes).find(node => node.type === 'root');
    expect(root).toMatchObject({ title: 'Root', path: ['Root'] });
    expect(texts).toContain('Root');
    expect(texts).not.toContain('루트');
    // The badge must be above the legend, rather than underneath its wide English labels.
    if (fixture === 'long') {
      expect(stamps.length).toBeGreaterThan(0);
      expect(stamps.every(y => y < 350)).toBe(true);
    }
  } finally { player.dispose(); }
});

test('draws a backward parent edge from the source left side to the target right side', () => {
  const paths: Array<{ start: number[]; end: number[] }> = [];
  let currentStart: number[] | null = null;
  let currentEnd: number[] | null = null;
  const context = new Proxy({}, { get: (_target, key) => key === 'measureText' ? (text: string) => ({ width: text.length * 7 })
    : key === 'beginPath' ? () => { currentStart = null; currentEnd = null; }
    : key === 'moveTo' ? (x: number, y: number) => { currentStart ??= [x, y]; currentEnd = [x, y]; }
    : key === 'lineTo' ? (x: number, y: number) => { currentEnd = [x, y]; }
    : key === 'bezierCurveTo' ? (_x1: number, _y1: number, _x2: number, _y2: number, x: number, y: number) => { currentEnd = [x, y]; }
    : key === 'stroke' ? () => { if (currentStart && currentEnd) paths.push({ start: currentStart, end: currentEnd }); }
    : key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as CanvasRenderingContext2D);
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1440, 900));
  const host = document.createElement('div'); host.innerHTML = markup; document.body.append(host);
  const player = createMotionPlayer(host, { onSelect: vi.fn(), onResults: vi.fn(), onMore: vi.fn(), onCancel: vi.fn() });
  try {
    const initialEvents: any[] = structuredClone(samples.atom);
    const sourceRef = 'step-000001:0003';
    for (const event of initialEvents) {
      if (event.event !== 'step_completed') continue;
      const source = event.data.candidates?.find((candidate: any) => candidate.ref === sourceRef);
      if (source) source.hop = 4;
      if (event.data.step.stage === 'selection') event.data.step.selected_refs.push('step-000005:0001');
    }
    player.begin('query');
    initialEvents.forEach(event => player.receive(event));
    settleFrames(frames);
    paths.length = 0;

    const events: any[] = structuredClone(initialEvents);
    let targetType = '';
    const targetNodeId = events.flatMap(event => event.data.candidates ?? []).find((candidate: any) => candidate.origin === 'hit_parent')?.node_id;
    for (const event of events) {
      for (const candidate of event.data.candidates ?? []) {
        if (candidate.ref === sourceRef) {
          candidate.physical_parent_node_id = targetNodeId;
          continue;
        }
        if (candidate.origin === 'hit_parent') {
          if (candidate.origin === 'hit_parent') targetType = candidate.card_type;
          continue;
        }
        candidate.card_id = `continued-${candidate.card_id}`;
        candidate.node_id = `continued-${candidate.node_id}`;
      }
      if (event.event !== 'step_completed' || event.data.step.stage !== 'hit_parent') continue;
      const target = event.data.candidates.find((candidate: any) => candidate.origin === 'hit_parent');
      const oldRef = target.ref;
      target.ref = 'continued-hit-parent';
      target.hit_ref = sourceRef;
      event.data.step.candidate_refs = [sourceRef, target.ref];
      for (const decision of event.data.step.decisions) if (decision.ref === oldRef) decision.ref = target.ref;
    }
    player.begin('query', { resume: true });
    events.forEach(event => player.receive(event));
    settleFrames(frames);

    const nodeWidth = Number.parseFloat(getComputedStyle(host).getPropertyValue('--motion-node-width')) || 268;
    const gap = Number.parseFloat(getComputedStyle(host).getPropertyValue('--motion-column-gap')) || 64;
    const expectedSourceLeft = 4 * (nodeWidth + gap);
    const expectedTargetRight = 1 * (nodeWidth + gap) + nodeWidth + (targetType === 'structure' ? 6 : 0);
    expect(paths.some(path => path.start[0] === expectedSourceLeft && path.end[0] === expectedTargetRight)).toBe(true);
  } finally { player.dispose(); }
});
