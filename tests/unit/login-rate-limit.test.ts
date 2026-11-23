import { createLoginRateLimiter } from '../../src/api/login-rate-limit.js';

describe('password login rate limiter', () => {
  let time: number;
  beforeEach(() => { time = 0; });

  it('blocks after ten failures, expires the window and resets independently', () => {
    const limiter = createLoginRateLimiter({ now: () => time });
    for (let i = 0; i < 10; i++) {
      expect(limiter.check('a')).toEqual({ blocked: false });
      limiter.recordFailure('a');
    }
    expect(limiter.check('a')).toEqual({ blocked: true, retryAfterSec: 60 });
    expect(limiter.check('b')).toEqual({ blocked: false });
    limiter.reset('a');
    expect(limiter.check('a')).toEqual({ blocked: false });
    for (let i = 0; i < 10; i++) limiter.recordFailure('a');
    time = 59_999;
    expect(limiter.check('a')).toEqual({ blocked: true, retryAfterSec: 1 });
    time = 60_000;
    expect(limiter.check('a')).toEqual({ blocked: false });
  });

  it('evicts the oldest key when the key limit is exceeded', () => {
    const limiter = createLoginRateLimiter({ now: () => time, maxKeys: 2, maxFailures: 1 });
    limiter.recordFailure('a');
    limiter.recordFailure('b');
    limiter.recordFailure('c');
    expect(limiter.check('a')).toEqual({ blocked: false });
    expect(limiter.check('b').blocked).toBe(true);
    expect(limiter.check('c').blocked).toBe(true);
  });
});
