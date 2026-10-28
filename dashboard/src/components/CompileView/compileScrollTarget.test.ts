// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { trackCompileTarget } from './compileScrollTarget';

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

function setup(align: 'start' | 'center' = 'start') {
  const scroll = document.createElement('div');
  document.body.append(scroll);
  Object.defineProperty(scroll, 'clientHeight', { value: 800 });
  scroll.getBoundingClientRect = () => ({ top: 100 } as DOMRect);
  let now = 0;
  let next = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++next, cb); return next; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  let position = 500;
  let ready = false;
  const locate = vi.fn(() => ({ top: position - scroll.scrollTop + 100, height: 20, ready }));
  const reveal = vi.fn();
  const cancelScroll = vi.fn();
  const write = vi.fn((offset: number) => { scroll.scrollTop = offset; });
  const stop = trackCompileTarget(scroll, { align, locate, reveal, write, cancelScroll });
  const frame = (ms = 16) => {
    now += ms;
    const callbacks = [...frames.values()]; frames.clear();
    callbacks.forEach(cb => cb(now));
  };
  return { scroll, frame, locate, write, reveal, stop, cancelScroll, frames,
    move: (top: number) => { position = top; }, ready: () => { ready = true; } };
}

test('keeps a heading at 16px through delayed measurements above it, then stops after stable frames', () => {
  const h = setup();
  h.frame();
  expect(h.scroll.scrollTop).toBe(484);
  for (let i = 0; i < 20; i++) h.frame();
  h.move(900); h.ready(); h.frame();
  expect(h.scroll.scrollTop).toBe(884);
  h.frame(); h.frame(); h.move(1200); h.frame();
  expect(h.scroll.scrollTop).toBe(1184);
  for (let i = 0; i < 6; i++) h.frame();
  expect(h.frames.size).toBe(0);
});

test('uses the same tracking for a match centered in the scroll viewport', () => {
  const h = setup('center');
  h.frame(); expect(h.scroll.scrollTop).toBe(110);
  h.move(1000); h.ready(); h.frame();
  expect(h.scroll.scrollTop).toBe(610);
  h.stop();
});

test('reveals an unmounted target again instead of aligning a detached element', () => {
  const h = setup();
  h.locate.mockReturnValueOnce(null!);
  h.frame(); expect(h.reveal).toHaveBeenCalledOnce();
  h.frame(); expect(h.scroll.scrollTop).toBe(484);
  h.stop();
});

test.each(['wheel', 'touchstart', 'keydown'])('a user %s input immediately ends tracking and library reconciliation', type => {
  const h = setup(); h.frame();
  if (type === 'keydown') h.scroll.dispatchEvent(new KeyboardEvent(type, { key: 'PageDown', bubbles: true }));
  else h.scroll.dispatchEvent(new Event(type, { bubbles: true }));
  const writes = h.write.mock.calls.length;
  h.move(900); h.frame();
  expect(h.write).toHaveBeenCalledTimes(writes);
  expect(h.frames.size).toBe(0);
  expect(h.cancelScroll).toHaveBeenCalled();
});

test('typing arrow keys in an input does not count as keyboard scrolling', () => {
  const h = setup();
  const input = document.createElement('input'); document.body.append(input);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  h.frame(); expect(h.write).toHaveBeenCalledOnce();
  h.stop();
});

test('stops an unresolved target after two seconds and can be disposed before a frame', () => {
  const h = setup(); h.locate.mockReturnValue(null!);
  h.frame(); h.frame(2001);
  expect(h.frames.size).toBe(0);
  const next = setup(); next.stop(); next.frame();
  expect(next.locate).not.toHaveBeenCalled();
});
