const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export async function submitPasswordLogin(
  password: string, fetchImpl: typeof fetch = fetch,
): Promise<'ok' | 'invalid' | 'rate_limited' | 'error'> {
  try {
    const response = await fetchImpl(`${BASE_URL}/api/auth/password-login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: JSON.stringify({ password }),
    });
    if (response.status === 200) return 'ok';
    if (response.status === 401) return 'invalid';
    if (response.status === 429) return 'rate_limited';
    return 'error';
  } catch {
    return 'error';
  }
}
