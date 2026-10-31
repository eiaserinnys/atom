import { randomBytes } from 'node:crypto';
import { SignJWT, type JWTPayload } from 'jose';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SLACK_AUTH_URL = 'https://slack.com/oauth/v2/authorize';

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
export const SLACK_TOKEN_URL = 'https://slack.com/api/oauth.v2.access';
export const SLACK_IDENTITY_URL = 'https://slack.com/api/users.identity';

export const JWT_COOKIE_NAME = 'atom_auth';
export const STATE_COOKIE_NAME = 'atom_oauth_state';
export const OAUTH_PENDING_COOKIE_NAME = 'atom_oauth_pending';
export const JWT_EXPIRY_SECONDS = 7 * 24 * 60 * 60;
export const ATOM_SEARCH_MOTION_RETURN_TO = 'atom-search-motion';

const authorizationCodeExpirations = new Map<string, number>();

export function extractAuthToken(req: {
  cookies?: Record<string, string | undefined>;
  headers: { authorization?: string | string[] };
}): string | undefined {
  const cookieToken = req.cookies?.[JWT_COOKIE_NAME];
  if (cookieToken) return cookieToken;

  const authorization = req.headers.authorization;
  if (typeof authorization !== 'string') return undefined;
  return authorization.match(/^Bearer\s+(\S+)$/i)?.[1];
}

export function isAllowedAccessJwtPayload(payload: JWTPayload): boolean {
  return payload['typ'] === undefined || payload['typ'] === 'access';
}

export function isLoopbackRedirectUri(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' &&
      url.username === '' &&
      url.password === '' &&
      url.hash === '' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export async function issueAuthorizationCode(input: {
  userId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope?: string;
  jwtSecret: Uint8Array;
}): Promise<string> {
  const now = Date.now();
  for (const [jti, expiresAt] of authorizationCodeExpirations) {
    if (expiresAt <= now) authorizationCodeExpirations.delete(jti);
  }

  const jti = randomBytes(16).toString('hex');
  authorizationCodeExpirations.set(jti, now + 300_000);
  const payload: JWTPayload = {
    typ: 'atom_oauth_code',
    sub: input.userId,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    ...(input.scope === undefined ? {} : { scope: input.scope }),
    jti,
  };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(input.jwtSecret);
}

export function consumeAuthorizationCode(jti: string): boolean {
  const expiresAt = authorizationCodeExpirations.get(jti);
  authorizationCodeExpirations.delete(jti);
  return expiresAt !== undefined && expiresAt > Date.now();
}

export function getSearchMotionPageUrl(): string | undefined {
  const configuredUrl = process.env['SEARCH_MOTION_PAGE_URL']?.trim();
  return configuredUrl ? configuredUrl.replace(/\/+$/, '') : undefined;
}

export function isAtomSearchMotionState(state: unknown): state is string {
  return typeof state === 'string' && /^[a-f0-9]{32}\.atom-search-motion$/.test(state);
}

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

export function getStateCookieOptions(nodeEnv: string | undefined) {
  return {
    httpOnly: true,
    secure: nodeEnv === 'production',
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
