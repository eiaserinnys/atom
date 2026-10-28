interface Target {
  top: number;
  height: number;
  ready: boolean;
}

interface Tracking {
  align: 'start' | 'center';
  locate: () => Target | null;
  reveal: () => void;
  write: (offset: number) => void;
  cancelScroll: () => void;
}

// Index scrolling reveals the target. Exact alignment then has a single owner,
// including measurements arriving after the target's own body.
export function trackCompileTarget(scroll: HTMLElement, tracking: Tracking) {
  let frame = 0;
  let startedAt: number | undefined;
  let previousPosition: number | undefined;
  let stableFrames = 0;
  const stop = () => {
    cancelAnimationFrame(frame);
    tracking.cancelScroll();
    scroll.removeEventListener('wheel', stop);
    scroll.removeEventListener('touchstart', stop);
    scroll.ownerDocument.removeEventListener('keydown', onKey);
  };
  const onKey = (event: KeyboardEvent) => {
    if ((event.target as Element)?.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) stop();
  };
  const tick = (now: number) => {
    startedAt ??= now;
    if (now - startedAt >= 2000) { stop(); return; }
    const target = tracking.locate();
    if (target) {
      tracking.cancelScroll();
      const position = target.top + scroll.scrollTop;
      const desired = scroll.getBoundingClientRect().top + (tracking.align === 'start' ? 16 : (scroll.clientHeight - target.height) / 2);
      const delta = target.top - desired;
      stableFrames = target.ready && Math.abs(delta) < 0.5 && previousPosition !== undefined && Math.abs(position - previousPosition) < 0.5
        ? stableFrames + 1 : 0;
      previousPosition = position;
      if (Math.abs(delta) >= 0.5) tracking.write(scroll.scrollTop + delta);
      if (stableFrames >= 4) { stop(); return; }
    } else {
      stableFrames = 0;
      previousPosition = undefined;
      tracking.reveal();
    }
    frame = requestAnimationFrame(tick);
  };
  scroll.addEventListener('wheel', stop, { passive: true });
  scroll.addEventListener('touchstart', stop, { passive: true });
  scroll.ownerDocument.addEventListener('keydown', onKey);
  frame = requestAnimationFrame(tick);
  return stop;
}
