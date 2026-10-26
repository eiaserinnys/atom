// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { createMotionPlayer } from './player.js';
import { createExplorationSession } from './exploration-session.js';
import markup from './motion.html?raw';
import samples from './fixtures/samples.json';

function continuation() {
  const events = structuredClone(samples.atom);
  for (const event of events as any[]) {
    for (const candidate of event.data.candidates ?? []) {
      candidate.card_id = `continued-${candidate.card_id}`;
      candidate.node_id = `continued-${candidate.node_id}`;
    }
  }
  return events;
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

test('a buffered continuation paints successive prefixes before completing, with cumulative search duration', () => {
  const context = new Proxy({}, { get: (_target, key) => key === 'measureText' ? (text: string) => ({ width: text.length * 7 }) : key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as CanvasRenderingContext2D);
  let reduced = true;
  vi.stubGlobal('matchMedia', () => ({ get matches() { return reduced; }, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1440, 900));
  const host = document.createElement('div'); host.innerHTML = markup; document.body.append(host);
  const player = createMotionPlayer(host, { onSelect: vi.fn(), onResults: vi.fn(), onMore: vi.fn(), onCancel: vi.fn(), translate: (key, values) => key === 'visual_search.seconds' ? `${values?.value} s` : key });
  const count = () => Number(host.querySelector('[data-motion-id=count]')!.textContent!.split('/')[0]);
  const more = () => [...player.getRecord().log.entries].length;
  try {
    player.begin('query'); samples.atom.forEach(event => player.receive(event));
    expect(count()).toBe(13);
    reduced = false; vi.useFakeTimers();
    player.begin('query', { resume: true });
    continuation().forEach(event => player.receive(event));
    expect(more()).toBe(2);
    expect(count()).toBeLessThan(26);
    const prefixes = new Set([count()]);
    for (let time = 0; time < 8000; time += 100) { vi.advanceTimersByTime(100); prefixes.add(count()); }
    expect(prefixes.size).toBeGreaterThan(5);
    expect(count()).toBe(26);
    expect(host.querySelector<HTMLInputElement>('[data-motion-id=t-skip]')!.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[data-motion-id=more]')!.disabled).toBe(false);
    const run = samples.atom[0].data as any; const done = samples.atom.at(-1)!.data as any;
    const seconds = ((Date.parse(done.completed_at) - Date.parse(run.started_at)) * 2 / 1000).toFixed(1);
    expect(host.querySelector('[data-motion-id=sum-time]')!.textContent).toBe(`${seconds} s`);
  } finally { player.dispose(); }
});

test('successive prefixes, rewinds, and a restored continuation produce identical scenes', () => {
  const session = createExplorationSession(); session.begin('query'); samples.atom.forEach(e => session.receive(e));
  session.project(session.timeline().frames.length);
  session.begin('query', { resume: true }); continuation().forEach(e => session.receive(e));
  const restored = createExplorationSession(); restored.restoreLog(session.exportLog());
  const length = session.timeline().frames.length;
  for (const cursor of [...Array.from({ length }, (_, i) => i + 1), 13, 21, length]) {
    const actual = session.project(cursor);
    const fresh = createExplorationSession(); fresh.restoreLog(restored.exportLog());
    expect(actual).toEqual(fresh.project(cursor));
  }
});
