import { describe, expect, it, vi } from 'vitest';
import { submitPasswordChange } from './passwordChange';

function respond(status: number, body?: unknown) {
  return vi.fn().mockResolvedValue({ status, json: () => Promise.resolve(body) }) as unknown as typeof fetch;
}

describe('submitPasswordChange', () => {
  it('posts both passwords with the session cookie', async () => {
    const fakeFetch = respond(200);
    expect(await submitPasswordChange('old-pass-1', 'new-pass-2', fakeFetch)).toBe('ok');
    expect(fakeFetch).toHaveBeenCalledWith(`${import.meta.env.VITE_API_BASE_URL ?? ''}/api/auth/password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: JSON.stringify({ current_password: 'old-pass-1', new_password: 'new-pass-2' }),
    });
  });
  it.each([
    [401, { code: 'INVALID_CURRENT_PASSWORD' }, 'wrong_current'],
    [401, { error: 'Unauthorized' }, 'save_failed'],
    [429, undefined, 'rate_limited'],
    [400, { code: 'INVALID_INPUT' }, 'invalid'],
    [500, { code: 'ENV_FILE_WRITE_FAILED' }, 'save_failed'],
  ] as const)('maps HTTP %i %j to %s', async (status, body, expected) => {
    expect(await submitPasswordChange('a', 'b', respond(status, body))).toBe(expected);
  });
  it('maps a network failure to save_failed', async () => {
    const offline = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    expect(await submitPasswordChange('a', 'b', offline)).toBe('save_failed');
  });
});
