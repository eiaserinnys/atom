import { FastifyPluginAsync, type FastifyRequest } from 'fastify';
import { jwtVerify, SignJWT } from 'jose';
import crypto from 'crypto';
import { createHash } from 'node:crypto';
import { findUserByEmail, findUserById, insertUser, type User } from '../../db/queries/users.js';
import type { DatabaseAdapter } from '../../db/adapter.js';
import { getDb } from '../../db/client.js';
import {
  JWT_COOKIE_NAME,
  OAUTH_PENDING_COOKIE_NAME,
  STATE_COOKIE_NAME,
  ATOM_SEARCH_MOTION_RETURN_TO,
  buildBypassAuthStatus,
  buildGoogleAuthRedirectUrl,
  buildSlackAuthRedirectUrl,
  getSearchMotionPageUrl,
  getProviderAvailability,
  getStateCookieOptions,
  isAllowedAccessJwtPayload,
  isLoopbackRedirectUri,
  isAtomSearchMotionState,
  issueAuthorizationCode,
  consumeAuthorizationCode,
  extractAuthToken,
} from './auth_helpers.js';
import { isAuthBypassEnabled } from '../auth-mode.js';
import type { AuthCallbackDeps } from './auth_callback_handlers.js';
import { handleGoogleCallback, handleSlackCallback } from './auth_callback_handlers.js';

export type AuthRoutesDeps = AuthCallbackDeps & {
  findUserById: (db: DatabaseAdapter, id: string) => Promise<User | null>;
};

const defaultAuthRoutesDeps: AuthRoutesDeps = {
  fetch: ((url, init) => globalThis.fetch(url, init)) as typeof fetch,
  getDb,
  findUserByEmail,
  insertUser,
  findUserById,
};

function getIssuer(req: FastifyRequest): string {
  const frontendUrl = process.env['FRONTEND_URL'] ?? '';
  if (/^https?:\/\//.test(frontendUrl)) {
    try {
      return new URL(frontendUrl).origin;
    } catch {
      // Fall through to the forwarded request origin.
    }
  }

  const firstHeaderValue = (value: string | string[] | undefined): string | undefined => {
    const first = Array.isArray(value) ? value[0] : value;
    return first?.split(',')[0]?.trim() || undefined;
  };
  const proto = firstHeaderValue(req.headers['x-forwarded-proto']) ?? 'http';
  const host = firstHeaderValue(req.headers['x-forwarded-host']) ??
    firstHeaderValue(req.headers.host) ?? 'localhost:4200';
  return `${proto}://${host}`;
}

function singleString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function oauthErrorRedirect(redirectUri: string, error: string, state: string): string {
  return `${redirectUri}?error=${encodeURIComponent(error)}&state=${encodeURIComponent(state)}`;
}

function buildOAuthAccessToken(user: Pick<User, 'id' | 'email' | 'display_name' | 'role'>, jwtSecret: Uint8Array) {
  return new SignJWT({
    id: user.id,
    email: user.email,
    name: user.display_name,
    role: user.role,
    typ: 'access',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('3600s')
    .sign(jwtSecret);
}

function buildOAuthRefreshToken(userId: string, clientId: string, jwtSecret: Uint8Array) {
  return new SignJWT({ sub: userId, client_id: clientId, typ: 'atom_oauth_refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(jwtSecret);
}

async function getAuthorizationUser(req: FastifyRequest, deps: AuthRoutesDeps, jwtSecret: Uint8Array): Promise<User | null> {
  if (isAuthBypassEnabled()) {
    return {
      id: 'bypass',
      email: 'bypass@local',
      display_name: 'Bypass Admin',
      role: 'admin',
      is_active: true,
      created_at: '',
    };
  }

  const token = req.cookies?.[JWT_COOKIE_NAME];
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwtSecret);
    if (!isAllowedAccessJwtPayload(payload) || typeof payload['id'] !== 'string') return null;
    const user = await deps.findUserById(deps.getDb(), payload['id']);
    return user?.is_active ? user : null;
  } catch {
    return null;
  }
}

export function createAuthRoutes(deps: AuthRoutesDeps = defaultAuthRoutesDeps): FastifyPluginAsync {
  return async (app) => {
    const jwtSecret = new TextEncoder().encode(process.env['JWT_SECRET']!);
    const frontendUrl = process.env['FRONTEND_URL'] ?? '';

    // ── Google OAuth ──────────────────────────────────────────────────────────
    const googleClientId = process.env['GOOGLE_CLIENT_ID'];
    const googleClientSecret = process.env['GOOGLE_CLIENT_SECRET'] ?? '';
    const googleCallbackUrl = process.env['GOOGLE_CALLBACK_URL'] ?? '';

    // ── Slack OAuth ───────────────────────────────────────────────────────────
    const slackClientId = process.env['SLACK_CLIENT_ID'];
    const slackClientSecret = process.env['SLACK_CLIENT_SECRET'] ?? '';
    const slackCallbackUrl = process.env['SLACK_CALLBACK_URL'] ?? '';
    const slackAllowedTeamId = process.env['SLACK_ALLOWED_TEAM_ID'];

    if (!app.hasContentTypeParser('application/x-www-form-urlencoded')) {
      app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
        const parsed = Object.fromEntries(new URLSearchParams(body as string).entries());
        done(null, parsed);
      });
    }

    const discoveryHandler = async (req: FastifyRequest, reply: import('fastify').FastifyReply) => {
      const issuer = getIssuer(req);
      return reply.send({
        issuer,
        authorization_endpoint: `${issuer}/api/auth/oauth/authorize`,
        token_endpoint: `${issuer}/api/auth/oauth/token`,
        registration_endpoint: `${issuer}/api/auth/oauth/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
      });
    };
    app.get('/.well-known/oauth-authorization-server', discoveryHandler);
    app.get('/api/auth/.well-known/oauth-authorization-server', discoveryHandler);

    app.post('/api/auth/oauth/register', async (req, reply) => {
      const body = req.body as Record<string, unknown> | undefined;
      const redirectUris = body?.['redirect_uris'];
      if (!Array.isArray(redirectUris) || redirectUris.length === 0 ||
        !redirectUris.every((uri) => typeof uri === 'string' && isLoopbackRedirectUri(uri))) {
        return reply.code(400).send({ error: 'invalid_redirect_uri' });
      }
      const tokenEndpointAuthMethod = body?.['token_endpoint_auth_method'];
      if (tokenEndpointAuthMethod !== undefined && tokenEndpointAuthMethod !== 'none') {
        return reply.code(400).send({ error: 'invalid_client_metadata' });
      }
      const clientName = body?.['client_name'] === undefined ? 'kaleidoscope' : body['client_name'];
      if (typeof clientName !== 'string') {
        return reply.code(400).send({ error: 'invalid_client_metadata' });
      }

      const clientId = await new SignJWT({ typ: 'atom_oauth_client', redirect_uris: redirectUris, client_name: clientName })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('365d')
        .sign(jwtSecret);
      return reply.code(201).send({
        client_id: clientId,
        client_name: clientName,
        redirect_uris: redirectUris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      });
    });

    app.get<{ Querystring: Record<string, string | string[] | undefined> }>(
      '/api/auth/oauth/authorize',
      async (req, reply) => {
        const query = req.query;
        const redirectUri = singleString(query['redirect_uri']);
        if (!redirectUri || !isLoopbackRedirectUri(redirectUri)) {
          return reply.code(400).send({ error: 'invalid_redirect_uri' });
        }
        const state = singleString(query['state']);
        if (!state) return reply.code(400).send({ error: 'invalid_request' });

        const clientId = singleString(query['client_id']);
        let clientPayload;
        try {
          if (!clientId) throw new Error('invalid client');
          ({ payload: clientPayload } = await jwtVerify(clientId, jwtSecret));
          if (clientPayload['typ'] !== 'atom_oauth_client' || !Array.isArray(clientPayload['redirect_uris'])) {
            throw new Error('invalid client');
          }
        } catch {
          return reply.redirect(oauthErrorRedirect(redirectUri, 'invalid_client', state));
        }
        if (!clientPayload['redirect_uris'].includes(redirectUri)) {
          return reply.code(400).send({ error: 'invalid_redirect_uri' });
        }

        const responseType = singleString(query['response_type']);
        const codeChallenge = singleString(query['code_challenge']);
        const codeChallengeMethod = singleString(query['code_challenge_method']);
        const scope = query['scope'] === undefined ? undefined : singleString(query['scope']);
        const provider = query['provider'] === undefined ? undefined : singleString(query['provider']);
        if (responseType !== 'code' || !codeChallenge || codeChallengeMethod !== 'S256' ||
          (query['scope'] !== undefined && scope === undefined) ||
          (query['provider'] !== undefined && provider === undefined)) {
          return reply.redirect(oauthErrorRedirect(redirectUri, 'invalid_request', state));
        }

        const user = await getAuthorizationUser(req, deps, jwtSecret);
        if (user) {
          const code = await issueAuthorizationCode({
            userId: user.id,
            clientId,
            redirectUri,
            codeChallenge,
            scope,
            jwtSecret,
          });
          return reply.redirect(`${redirectUri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`);
        }

        const pending = await new SignJWT({
          typ: 'atom_oauth_pending',
          client_id: clientId,
          redirect_uri: redirectUri,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          state,
          ...(scope === undefined ? {} : { scope }),
        })
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(jwtSecret);
        reply.setCookie(OAUTH_PENDING_COOKIE_NAME, pending, getStateCookieOptions(process.env['NODE_ENV']));

        if (provider === 'slack' && slackClientId) return reply.redirect('/api/auth/slack');
        if (googleClientId) return reply.redirect('/api/auth/google');
        if (slackClientId) return reply.redirect('/api/auth/slack');
        return reply.code(503).send({ error: 'OAuth login provider not configured' });
      },
    );

    app.post('/api/auth/oauth/token', async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      const body = req.body as Record<string, unknown> | undefined;
      const grantType = singleString(body?.['grant_type']);
      const clientId = singleString(body?.['client_id']);
      if (grantType !== 'authorization_code' && grantType !== 'refresh_token') {
        return reply.code(400).send({ error: 'unsupported_grant_type' });
      }
      if (!clientId) return reply.code(400).send({ error: 'invalid_request' });

      let clientPayload;
      try {
        ({ payload: clientPayload } = await jwtVerify(clientId, jwtSecret));
        if (clientPayload['typ'] !== 'atom_oauth_client') throw new Error('invalid client');
      } catch {
        return reply.code(400).send({ error: 'invalid_client' });
      }

      let user: User | null = null;
      if (grantType === 'authorization_code') {
        const code = singleString(body?.['code']);
        const redirectUri = singleString(body?.['redirect_uri']);
        const codeVerifier = singleString(body?.['code_verifier']);
        if (!code || !redirectUri || !codeVerifier) return reply.code(400).send({ error: 'invalid_request' });

        let codePayload;
        try {
          ({ payload: codePayload } = await jwtVerify(code, jwtSecret));
          if (codePayload['typ'] !== 'atom_oauth_code' || typeof codePayload['jti'] !== 'string') {
            throw new Error('invalid code');
          }
        } catch {
          return reply.code(400).send({ error: 'invalid_grant' });
        }
        if (!consumeAuthorizationCode(codePayload['jti'])) return reply.code(400).send({ error: 'invalid_grant' });
        if (codePayload['client_id'] !== clientId || codePayload['redirect_uri'] !== redirectUri ||
          typeof codePayload['code_challenge'] !== 'string' ||
          createHash('sha256').update(codeVerifier).digest('base64url') !== codePayload['code_challenge']) {
          return reply.code(400).send({ error: 'invalid_grant' });
        }

        const userId = codePayload['sub'];
        if (userId === 'bypass' && isAuthBypassEnabled()) {
          user = {
            id: 'bypass',
            email: 'bypass@local',
            display_name: 'Bypass Admin',
            role: 'admin',
            is_active: true,
            created_at: '',
          };
        } else if (typeof userId === 'string') {
          const found = await deps.findUserById(deps.getDb(), userId);
          if (found?.is_active) user = found;
        }
        if (!user) return reply.code(400).send({ error: 'invalid_grant' });
      } else {
        const refreshToken = singleString(body?.['refresh_token']);
        if (!refreshToken) return reply.code(400).send({ error: 'invalid_request' });
        let refreshPayload;
        try {
          ({ payload: refreshPayload } = await jwtVerify(refreshToken, jwtSecret));
          if (refreshPayload['typ'] !== 'atom_oauth_refresh' || refreshPayload['client_id'] !== clientId) {
            throw new Error('invalid refresh token');
          }
        } catch {
          return reply.code(400).send({ error: 'invalid_grant' });
        }
        const userId = refreshPayload['sub'];
        if (userId === 'bypass' && isAuthBypassEnabled()) {
          user = {
            id: 'bypass',
            email: 'bypass@local',
            display_name: 'Bypass Admin',
            role: 'admin',
            is_active: true,
            created_at: '',
          };
        } else if (typeof userId === 'string') {
          const found = await deps.findUserById(deps.getDb(), userId);
          if (found?.is_active) user = found;
        }
        if (!user) return reply.code(400).send({ error: 'invalid_grant' });
      }

      const accessToken = await buildOAuthAccessToken(user, jwtSecret);
      const refreshToken = await buildOAuthRefreshToken(user.id, clientId, jwtSecret);
      return reply.send({ access_token: accessToken, token_type: 'Bearer', expires_in: 3600, refresh_token: refreshToken });
    });

    // ── Google OAuth routes ───────────────────────────────────────────────────

    // GET /api/auth/google — redirect to Google OAuth
    app.get<{ Querystring: { return_to?: string | string[] } }>(
      '/api/auth/google',
      async (req, reply) => {
        const returnTo = req.query.return_to;
        const searchMotionPageUrl = getSearchMotionPageUrl();
        if (
          Array.isArray(returnTo) ||
          (returnTo !== undefined &&
            (returnTo !== ATOM_SEARCH_MOTION_RETURN_TO || !searchMotionPageUrl))
        ) {
          return reply.code(400).send({ error: 'Invalid return_to' });
        }

        if (!googleClientId) {
          return reply.code(503).send({ error: 'Google auth not configured' });
        }

        const nonce = crypto.randomBytes(16).toString('hex');
        const state = returnTo ? nonce + '.' + ATOM_SEARCH_MOTION_RETURN_TO : nonce;
        reply.setCookie(STATE_COOKIE_NAME, state, getStateCookieOptions(process.env['NODE_ENV']));

        return reply.redirect(buildGoogleAuthRedirectUrl({
          clientId: googleClientId,
          callbackUrl: googleCallbackUrl,
          state,
        }));
      },
    );

    // GET /api/auth/google/callback
    app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
      '/api/auth/google/callback',
      async (req, reply) => {
        const { code, state, error } = req.query;
        const storedState = req.cookies[STATE_COOKIE_NAME];
        const searchMotionPageUrl = getSearchMotionPageUrl();
        const motionReturn = Boolean(searchMotionPageUrl) &&
          isAtomSearchMotionState(state) &&
          storedState === state;

        if (motionReturn && (error || !code)) {
          reply.clearCookie(STATE_COOKIE_NAME, { path: '/' });
          const authError = error ? 'google_error' : 'missing_code';
          return reply.redirect(searchMotionPageUrl + '/?auth_error=' + authError);
        }

        if (error || !code || !state) {
          return reply.redirect(`${frontendUrl}/?auth_error=1`);
        }

        reply.clearCookie(STATE_COOKIE_NAME, { path: '/' });

        if (!storedState || storedState !== state) {
          return reply.redirect(`${frontendUrl}/?auth_error=invalid_state`);
        }

        return handleGoogleCallback({
          deps,
          reply,
          frontendUrl: motionReturn ? searchMotionPageUrl! : frontendUrl,
          successRedirectUrl: motionReturn ? searchMotionPageUrl + '/' : undefined,
          jwtSecret,
          code,
          pendingOAuthToken: req.cookies?.[OAUTH_PENDING_COOKIE_NAME],
          googleClientId: googleClientId!,
          googleClientSecret,
          googleCallbackUrl,
          allowedEmail: process.env['ALLOWED_EMAIL'],
        });
      },
    );

    // ── Slack OAuth routes ────────────────────────────────────────────────────

    // GET /api/auth/slack — redirect to Slack OAuth
    app.get('/api/auth/slack', async (_req, reply) => {
      if (!slackClientId) {
        return reply.code(503).send({ error: 'Slack auth not configured' });
      }

      const state = crypto.randomBytes(16).toString('hex');
      reply.setCookie(STATE_COOKIE_NAME, state, getStateCookieOptions(process.env['NODE_ENV']));

      return reply.redirect(buildSlackAuthRedirectUrl({
        clientId: slackClientId,
        callbackUrl: slackCallbackUrl,
        state,
      }));
    });

    // GET /api/auth/slack/callback
    app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
      '/api/auth/slack/callback',
      async (req, reply) => {
        const { code, state, error } = req.query;

        if (error || !code || !state) {
          return reply.redirect(`${frontendUrl}/?auth_error=1`);
        }

        const storedState = req.cookies[STATE_COOKIE_NAME];
        reply.clearCookie(STATE_COOKIE_NAME, { path: '/' });

        if (!storedState || storedState !== state) {
          return reply.redirect(`${frontendUrl}/?auth_error=invalid_state`);
        }

        return handleSlackCallback({
          deps,
          log: app.log,
          reply,
          frontendUrl,
          jwtSecret,
          code,
          pendingOAuthToken: req.cookies?.[OAUTH_PENDING_COOKIE_NAME],
          slackClientId: slackClientId!,
          slackClientSecret,
          slackCallbackUrl,
          slackAllowedTeamId,
        });
      },
    );

    // ── Common routes ─────────────────────────────────────────────────────────

    // GET /api/auth/providers — return available OAuth providers
    app.get('/api/auth/providers', async (_req, reply) => {
      return reply.send(getProviderAvailability({ googleClientId, slackClientId }));
    });

    // GET /api/auth/status — return current auth state
    app.get('/api/auth/status', async (req, reply) => {
      if (isAuthBypassEnabled()) {
        return reply.send(buildBypassAuthStatus());
      }

      if (!googleClientId && !slackClientId) {
        return reply.send({ authenticated: false });
      }

      const token = extractAuthToken(req);
      if (!token) {
        return reply.send({ authenticated: false });
      }

      try {
        const { payload } = await jwtVerify(token, jwtSecret);
        if (!isAllowedAccessJwtPayload(payload)) {
          return reply.send({ authenticated: false });
        }
        const userId = payload['id'];
        const user = typeof userId === 'string' ? await deps.findUserById(deps.getDb(), userId) : null;
        if (!user?.is_active) {
          return reply.send({ authenticated: false });
        }
        return reply.send({
          authenticated: true,
          id: user.id,
          email: user.email,
          name: user.display_name ?? payload['name'],
          role: user.role,
        });
      } catch {
        return reply.send({ authenticated: false });
      }
    });

    // POST /api/auth/logout — clear JWT cookie
    app.post('/api/auth/logout', async (_req, reply) => {
      reply.clearCookie(JWT_COOKIE_NAME, { path: '/' });
      return reply.send({ ok: true });
    });
  };
};

export const authRoutes = createAuthRoutes();
