let activeRuns = 0;

export function tryAcquireJevRunSlot(limit: number): (() => void) | null {
  if (activeRuns >= limit) return null;
  activeRuns += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeRuns -= 1;
  };
}
