export type AuthMode = 'oauth' | 'password' | 'bypass';

export function getDashboardAdminPassword(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env['DASHBOARD_ADMIN_PASSWORD']?.trim() || undefined;
}

/** undefined when no login method is configured; the server refuses to start in that case. */
export function resolveAuthMode(env: NodeJS.ProcessEnv = process.env): AuthMode | undefined {
  if (env['GOOGLE_CLIENT_ID'] || env['SLACK_CLIENT_ID']) return 'oauth';
  if (getDashboardAdminPassword(env)) return 'password';
  if (env['AUTH_BYPASS'] === '1') return 'bypass';
  return undefined;
}

export function isAuthBypassEnabled(): boolean {
  return resolveAuthMode() === 'bypass';
}
