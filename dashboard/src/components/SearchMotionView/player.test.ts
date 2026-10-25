// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { createMotionPlayer } from './player.js';
import markup from './motion.html?raw';
import samples from './samples.json';
import type { MotionEvent } from './stream';

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
