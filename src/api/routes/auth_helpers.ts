const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SLACK_AUTH_URL = 'https://slack.com/oauth/v2/authorize';

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
export const SLACK_TOKEN_URL = 'https://slack.com/api/oauth.v2.access';
export const SLACK_IDENTITY_URL = 'https://slack.com/api/users.identity';

export const JWT_COOKIE_NAME = 'atom_auth';
export const STATE_COOKIE_NAME = 'atom_oauth_state';
export const JWT_EXPIRY_SECONDS = 7 * 24 * 60 * 60;

export type ProviderAvailability = {
  google: boolean;
  slack: boolean;
};

export type BypassAuthStatus = {
  authenticated: true;
  id: 'bypass';
  email: 'bypass@local';
  name: 'Bypass Admin';
  role: 'admin';
};

export function buildGoogleAuthRedirectUrl(input: {
  clientId: string;
  callbackUrl: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.callbackUrl,
    response_type: 'code',
    scope: 'openid email profile',
    state: input.state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export function buildSlackAuthRedirectUrl(input: {
  clientId: string;
  callbackUrl: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.callbackUrl,
    user_scope: 'identity.basic,identity.email,identity.avatar',
    state: input.state,
  });
  return `${SLACK_AUTH_URL}?${params.toString()}`;
}

export function getProviderAvailability(input: {
  googleClientId?: string;
  slackClientId?: string;
}): ProviderAvailability {
  return {
    google: !!input.googleClientId,
    slack: !!input.slackClientId,
  };
}

export function buildBypassAuthStatus(): BypassAuthStatus {
  return {
    authenticated: true,
    id: 'bypass',
    email: 'bypass@local',
    name: 'Bypass Admin',
    role: 'admin',
  };
}

export function isSlackWorkspaceAllowed(teamId: string, allowedTeamId?: string): boolean {
  return !allowedTeamId || teamId === allowedTeamId;
}

export function getStateCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 300,
  };
}

export function getJwtCookieOptions(nodeEnv: string | undefined) {
  return {
    httpOnly: true,
    secure: nodeEnv === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: JWT_EXPIRY_SECONDS,
  };
}
