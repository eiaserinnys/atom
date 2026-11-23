export function createLoginRateLimiter({
  windowMs = 60_000, maxFailures = 10, maxKeys = 10_000, now = Date.now,
}: { windowMs?: number; maxFailures?: number; maxKeys?: number; now?: () => number } = {}) {
  const failures = new Map<string, number[]>();

  function current(key: string, time: number): number[] {
    const recent = (failures.get(key) ?? []).filter((at) => at > time - windowMs);
    if (recent.length) failures.set(key, recent);
    else failures.delete(key);
    return recent;
  }

  return {
    check(key: string): { blocked: false } | { blocked: true; retryAfterSec: number } {
      const time = now();
      const recent = current(key, time);
      if (recent.length < maxFailures) return { blocked: false };
      return { blocked: true, retryAfterSec: Math.max(1, Math.ceil((recent[0] + windowMs - time) / 1000)) };
    },
    recordFailure(key: string): void {
      const time = now();
      const recent = current(key, time);
      recent.push(time);
      failures.set(key, recent);
      while (failures.size > maxKeys) failures.delete(failures.keys().next().value!);
    },
    reset(key: string): void { failures.delete(key); },
  };
}
