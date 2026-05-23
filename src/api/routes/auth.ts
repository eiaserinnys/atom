import { FastifyPluginAsync, FastifyReply } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import crypto from 'crypto';
import { findUserByEmail, insertUser, isEmailAllowed, type User } from '../../db/queries/users.js';
import { getDb } from '../../db/client.js';
import type { DatabaseAdapter } from '../../db/adapter.js';
import {
  GOOGLE_TOKEN_URL,
  GOOGLE_USERINFO_URL,
  JWT_COOKIE_NAME,
  JWT_EXPIRY_SECONDS,
  SLACK_IDENTITY_URL,
  SLACK_TOKEN_URL,
  STATE_COOKIE_NAME,
  buildBypassAuthStatus,
  buildGoogleAuthRedirectUrl,
  buildSlackAuthRedirectUrl,
  getJwtCookieOptions,
  getProviderAvailability,
  getStateCookieOptions,
  isSlackWorkspaceAllowed,
} from './auth_helpers.js';

export type AuthRoutesDeps = {
  fetch: typeof fetch;
  getDb: () => DatabaseAdapter;
  findUserByEmail: (db: DatabaseAdapter, email: string) => Promise<User | null>;
  insertUser: (
    db: DatabaseAdapter,
    input: { email: string; display_name?: string; role: User['role'] },
  ) => Promise<User>;
};

/**
 * Issue a JWT cookie and redirect to frontend home.
 * Shared by both Google and Slack OAuth flows.
 */
async function issueJwtAndRedirect(
  reply: FastifyReply,
  frontendUrl: string,
  jwtSecret: Uint8Array,
  dbUser: { id: string; role: string },
  email: string,
  name: string,
) {
  const token = await new SignJWT({
    id: dbUser.id,
    email,
    name,
    role: dbUser.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${JWT_EXPIRY_SECONDS}s`)
    .sign(jwtSecret);

  reply.setCookie(JWT_COOKIE_NAME, token, getJwtCookieOptions(process.env['NODE_ENV']));

  return reply.redirect(frontendUrl || '/');
}

const defaultAuthRoutesDeps: AuthRoutesDeps = {
  fetch: ((url, init) => globalThis.fetch(url, init)) as typeof fetch,
  getDb,
  findUserByEmail,
  insertUser,
};

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

    // At least one OAuth provider must be configured
    const authConfigured = !!googleClientId || !!slackClientId;

    // ── Google OAuth routes ───────────────────────────────────────────────────

    // GET /api/auth/google — redirect to Google OAuth
    app.get('/api/auth/google', async (_req, reply) => {
      if (!googleClientId) {
        return reply.code(503).send({ error: 'Google auth not configured' });
      }

      const state = crypto.randomBytes(16).toString('hex');
      reply.setCookie(STATE_COOKIE_NAME, state, getStateCookieOptions());

      return reply.redirect(buildGoogleAuthRedirectUrl({
        clientId: googleClientId,
        callbackUrl: googleCallbackUrl,
        state,
      }));
    });

    // GET /api/auth/google/callback
    app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
      '/api/auth/google/callback',
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

        // Exchange code for tokens
        const tokenRes = await deps.fetch(GOOGLE_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: googleClientId!,
            client_secret: googleClientSecret,
            redirect_uri: googleCallbackUrl,
            grant_type: 'authorization_code',
          }),
        });

        if (!tokenRes.ok) {
          return reply.redirect(`${frontendUrl}/?auth_error=token_exchange`);
        }

        const tokenData = (await tokenRes.json()) as { access_token: string };

        // Fetch user info
        const userRes = await deps.fetch(GOOGLE_USERINFO_URL, {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });

        if (!userRes.ok) {
          return reply.redirect(`${frontendUrl}/?auth_error=userinfo`);
        }

        const user = (await userRes.json()) as { email: string; name: string };

        // Google: check users table, auto-create if ALLOWED_EMAIL domain matches
        const allowedEmail = process.env['ALLOWED_EMAIL'];
        const db = deps.getDb();
        let dbUser = await deps.findUserByEmail(db, user.email);
        if (!dbUser && isEmailAllowed(user.email, allowedEmail)) {
          dbUser = await deps.insertUser(db, { email: user.email, display_name: user.name, role: 'editor' });
        }
        if (!dbUser) return reply.redirect(`${frontendUrl}/?auth_error=unauthorized`);
        if (!dbUser.is_active) return reply.redirect(`${frontendUrl}/?auth_error=deactivated`);

        return issueJwtAndRedirect(reply, frontendUrl, jwtSecret, dbUser, user.email, user.name);
      },
    );

    // ── Slack OAuth routes ────────────────────────────────────────────────────

    // GET /api/auth/slack — redirect to Slack OAuth
    app.get('/api/auth/slack', async (_req, reply) => {
      if (!slackClientId) {
        return reply.code(503).send({ error: 'Slack auth not configured' });
      }

      const state = crypto.randomBytes(16).toString('hex');
      reply.setCookie(STATE_COOKIE_NAME, state, getStateCookieOptions());

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

        // Exchange code for tokens
        const tokenRes = await deps.fetch(SLACK_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: slackClientId!,
            client_secret: slackClientSecret,
            redirect_uri: slackCallbackUrl,
          }),
        });

        if (!tokenRes.ok) {
          app.log.warn('Slack OAuth token exchange failed');
          return reply.redirect(`${frontendUrl}/?auth_error=token_exchange`);
        }

        const tokenData = (await tokenRes.json()) as {
          ok: boolean;
          error?: string;
          authed_user?: { access_token: string };
        };

        if (!tokenData.ok || !tokenData.authed_user?.access_token) {
          app.log.warn({ error: tokenData.error }, 'Slack OAuth token exchange failed');
          return reply.redirect(`${frontendUrl}/?auth_error=token_exchange`);
        }

        // Fetch user identity
        const identityRes = await deps.fetch(SLACK_IDENTITY_URL, {
          headers: { Authorization: `Bearer ${tokenData.authed_user.access_token}` },
        });

        if (!identityRes.ok) {
          app.log.warn('Slack identity fetch failed');
          return reply.redirect(`${frontendUrl}/?auth_error=userinfo`);
        }

        const identityData = (await identityRes.json()) as {
          ok: boolean;
          error?: string;
          user: { id: string; name: string; email: string; image_512?: string; image_192?: string };
          team: { id: string; name: string };
        };

        if (!identityData.ok) {
          app.log.warn({ error: identityData.error }, 'Slack identity fetch failed');
          return reply.redirect(`${frontendUrl}/?auth_error=userinfo`);
        }

        // Verify workspace if SLACK_ALLOWED_TEAM_ID is set
        if (!isSlackWorkspaceAllowed(identityData.team.id, slackAllowedTeamId)) {
          app.log.warn(
            { teamId: identityData.team.id, email: identityData.user.email },
            'Unauthorized Slack workspace access attempt',
          );
          return reply.redirect(`${frontendUrl}/?auth_error=unauthorized_workspace`);
        }

        // Slack: workspace 검증 통과 시 자동 유저 생성 (이메일 체크 불필요)
        const email = identityData.user.email;
        const name = identityData.user.name;
        const db = deps.getDb();
        let dbUser = await deps.findUserByEmail(db, email);
        if (!dbUser) {
          dbUser = await deps.insertUser(db, { email, display_name: name, role: 'editor' });
          app.log.info({ email, name }, 'Auto-created user from Slack OAuth');
        }
        if (!dbUser.is_active) return reply.redirect(`${frontendUrl}/?auth_error=deactivated`);

        return issueJwtAndRedirect(reply, frontendUrl, jwtSecret, dbUser, email, name);
      },
    );

    // ── Common routes ─────────────────────────────────────────────────────────

    // GET /api/auth/providers — return available OAuth providers
    app.get('/api/auth/providers', async (_req, reply) => {
      return reply.send(getProviderAvailability({ googleClientId, slackClientId }));
    });

    // GET /api/auth/status — return current auth state
    app.get('/api/auth/status', async (req, reply) => {
      if (!authConfigured) {
        return reply.send(buildBypassAuthStatus());
      }

      const token = req.cookies[JWT_COOKIE_NAME];
      if (!token) {
        return reply.send({ authenticated: false });
      }

      try {
        const { payload } = await jwtVerify(token, jwtSecret);
        return reply.send({
          authenticated: true,
          id: payload['id'],
          email: payload['email'],
          name: payload['name'],
          role: payload['role'],
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
