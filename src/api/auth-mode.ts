export type AuthMode = 'oauth' | 'password' | 'bypass' | 'unconfigured';

export function getDashboardAdminPassword(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env['DASHBOARD_ADMIN_PASSWORD']?.trim() || undefined;
}

export function resolveAuthMode(env: NodeJS.ProcessEnv = process.env): AuthMode {
  if (env['GOOGLE_CLIENT_ID'] || env['SLACK_CLIENT_ID']) return 'oauth';
  if (getDashboardAdminPassword(env)) return 'password';
  if (env['AUTH_BYPASS'] === '1') return 'bypass';
  return 'unconfigured';
}

export function isAuthBypassEnabled(): boolean {
  return resolveAuthMode() === 'bypass';
}
