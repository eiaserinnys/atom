import { describe, expect, it, vi } from 'vitest';
import { submitPasswordLogin } from './passwordLogin';

describe('submitPasswordLogin', () => {
  it.each([[200, 'ok'], [401, 'invalid'], [429, 'rate_limited'], [500, 'error']] as const)(
    'maps HTTP %i to %s and sends the password', async (status, expected) => {
      const fakeFetch = vi.fn().mockResolvedValue({ status }) as unknown as typeof fetch;
      expect(await submitPasswordLogin('secret', fakeFetch)).toBe(expected);
      expect(fakeFetch).toHaveBeenCalledWith(`${import.meta.env.VITE_API_BASE_URL ?? ''}/api/auth/password-login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', body: JSON.stringify({ password: 'secret' }),
      });
    },
  );
  it('maps a network failure to error', async () => {
    const fakeFetch = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    expect(await submitPasswordLogin('secret', fakeFetch)).toBe('error');
  });
});
