const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export type PasswordChangeResult = 'ok' | 'wrong_current' | 'rate_limited' | 'invalid' | 'save_failed';

export async function submitPasswordChange(
  currentPassword: string, newPassword: string, fetchImpl: typeof fetch = fetch,
): Promise<PasswordChangeResult> {
  try {
    const response = await fetchImpl(`${BASE_URL}/api/auth/password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
    if (response.status === 200) return 'ok';
    if (response.status === 429) return 'rate_limited';
    if (response.status === 400) return 'invalid';
    if (response.status === 401) {
      const body = await response.json().catch(() => null);
      if (body?.code === 'INVALID_CURRENT_PASSWORD') return 'wrong_current';
    }
    return 'save_failed';
  } catch {
    return 'save_failed';
  }
}
