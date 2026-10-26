// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { createMotionPlayer } from './player.js';
import { createExplorationSession } from './exploration-session.js';
import markup from './motion.html?raw';
import samples from './fixtures/samples.json';

const events = samples.atom as any[];
function rig() {
  let reduced = true;
  const texts: string[] = [];
  const context = new Proxy({}, { get: (_t, key) => key === 'measureText' ? (s: string) => ({ width: s.length * 7 }) : key === 'fillText' ? (s: string) => texts.push(s) : key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as CanvasRenderingContext2D);
  vi.stubGlobal('matchMedia', () => ({ get matches() { return reduced; }, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 640, 600));
  const host = document.createElement('div'); host.innerHTML = markup; document.body.append(host);
  const player = createMotionPlayer(host, { onResults: vi.fn(), onSelect: vi.fn(), onMore: vi.fn(), onCancel: vi.fn(), translate: (key, args) => key === 'visual_search.seconds' ? String(args?.value) : key === 'visual_search.narrate' ? `${args?.hop}: ${args?.stage}` : key });
  const button = (id: string) => host.querySelector<HTMLInputElement>(`[data-motion-id=${id}]`)!;
  const count = () => Number(button('count').textContent!.split('/')[0]);
  player.begin('query'); events.forEach(e => player.receive(e));
  vi.useFakeTimers();
  return { player, button, count, texts, motion: (value: boolean) => { reduced = !value; } };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

test('A: continuation expansion and gate frames mark the existing canonical nodes', () => {
  const s = createExplorationSession(); s.begin('q'); events.forEach(e => s.receive(e));
  const first = s.timeline().frames.length; const initial = s.project(first).scene;
  s.begin('q', { resume: true }); events.forEach(e => s.receive(e));
  const frames = s.timeline().frames;
  for (const stage of ['atom_outline', 'structure_noul', 'content_noul', 'sufficiency_noul']) {
    const at = frames.findIndex((f: any, i: number) => i >= first && f.events.some((e: any) => e.event === 'step_completed' && e.data.step.stage === stage));
    expect(at).toBeGreaterThanOrEqual(first);
    const scene = (s.project as any)(at + 1, false, true).scene;
    const active = [...scene.nodes.values()].filter((n: any) => stage === 'atom_outline' ? n.reading > 0 : n.judging);
    expect(active.length).toBeGreaterThan(0);
    expect(active.every((n: any) => initial.nodes.has(n.ref))).toBe(true);
    if (stage !== 'atom_outline') expect(active.every((n: any) => n.score === null)).toBe(true);
    expect(scene.inflight.size).toBeGreaterThan(0);
  }
});

test('B: continuation narration, terminal state and elapsed time belong to the current prefix', () => {
  const s = createExplorationSession(); s.begin('q'); events.forEach(e => s.receive(e));
  const first = s.timeline().frames.length; const initial = s.project(first).scene;
  s.begin('q', { resume: true }); events.forEach(e => s.receive(e));
  const scene = (s.project as any)(first + 3, false, true).scene;
  const step = s.timeline().frames[first + 2].events.find((e: any) => e.event === 'step_completed')!.data.step;
  expect(scene.last).toMatchObject({ stage: step.stage, hop: step.hop });
  expect(scene.terminal).toBeNull();
  expect(scene.searchDurationMs).toBeGreaterThan(initial.searchDurationMs);
  expect(scene.searchDurationMs).toBeLessThan(initial.searchDurationMs * 2);
});

test('C: reduced-motion continuation reaches the final frame without timer-by-timer playback', () => {
  const r = rig();
  try { r.player.begin('q', { resume: true }); events.forEach(e => r.player.receive(e)); expect(r.count()).toBe(26); expect(r.button('t-skip').disabled).toBe(true); }
  finally { r.player.dispose(); }
});

test('D: continuation skip lands at the same last-hop camera as natural completion', () => {
  const r = rig();
  const extra = structuredClone(events);
  for (const e of extra) for (const c of e.data.candidates ?? []) { c.card_id = `new-${c.card_id}`; c.node_id = `new-${c.node_id}`; }
  try {
    r.motion(true); r.player.begin('q', { resume: true }); extra.forEach(e => r.player.receive(e));
    const record = r.player.getRecord();
    vi.advanceTimersByTime(10000); const end = r.player.getCamera();
    expect(record.cursor).toBeLessThan(26);
    const skipped = rig();
    try {
      skipped.motion(true); skipped.player.begin('q', { resume: true }); extra.forEach(e => skipped.player.receive(e));
      skipped.button('t-skip').checked = true; skipped.button('t-skip').dispatchEvent(new Event('change'));
      expect(skipped.player.getCamera().x).toBeGreaterThan(0);
      expect(skipped.player.getCamera()).toEqual(end);
    } finally { skipped.player.dispose(); }
  } finally { r.player.dispose(); }
});

test('E: unchecking skip while SSE is arriving resumes the continuation queue', () => {
  const r = rig();
  try {
    r.motion(true); r.player.begin('q', { resume: true });
    const split = Math.floor(events.length / 2);
    events.slice(0, split).forEach(e => r.player.receive(e));
    r.button('t-skip').checked = true; r.button('t-skip').dispatchEvent(new Event('change'));
    events.slice(split, -1).forEach(e => r.player.receive(e));
    r.button('t-skip').checked = false; r.button('t-skip').dispatchEvent(new Event('change'));
    vi.advanceTimersByTime(10000);
    expect(r.count()).toBe(26);
    r.player.receive(events.at(-1)!); vi.advanceTimersByTime(10000);
    expect(r.count()).toBe(26); expect(r.button('t-skip').disabled).toBe(true);
  } finally { r.player.dispose(); }
});
