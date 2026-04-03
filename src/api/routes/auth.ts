import { FastifyPluginAsync } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import crypto from 'crypto';
import { findUserByEmail } from '../../db/queries/users.js';
import { getPool } from '../../db/client.js';

// Google OAuth
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

// Slack OAuth
const SLACK_AUTH_URL = 'https://slack.com/oauth/v2/authorize';
const SLACK_TOKEN_URL = 'https://slack.com/api/oauth.v2.access';
const SLACK_IDENTITY_URL = 'https://slack.com/api/users.identity';

const JWT_COOKIE_NAME = 'atom_auth';
const STATE_COOKIE_NAME = 'atom_oauth_state';
const JWT_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Issue a JWT cookie and redirect to home.
 * Shared by both Google and Slack OAuth flows.
 */
async function issueJwtAndRedirect(
  reply: Parameters<Parameters<FastifyPluginAsync>[0]['get']>[1] extends (...args: infer A) => unknown ? A[1] : never,
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

  reply.setCookie(JWT_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: JWT_EXPIRY_SECONDS,
  });

  return reply.redirect('/');
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  const jwtSecret = new TextEncoder().encode(process.env['JWT_SECRET']!);

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
    reply.setCookie(STATE_COOKIE_NAME, state, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 300,
    });

    const params = new URLSearchParams({
      client_id: googleClientId,
      redirect_uri: googleCallbackUrl,
      response_type: 'code',
      scope: 'openid email profile',
      state,
    });

    return reply.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
  });

  // GET /api/auth/google/callback
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/api/auth/google/callback',
    async (req, reply) => {
      const { code, state, error } = req.query;

      if (error || !code || !state) {
        return reply.redirect('/?auth_error=1');
      }

      const storedState = req.cookies[STATE_COOKIE_NAME];
      reply.clearCookie(STATE_COOKIE_NAME, { path: '/' });

      if (!storedState || storedState !== state) {
        return reply.redirect('/?auth_error=invalid_state');
      }

      // Exchange code for tokens
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
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
        return reply.redirect('/?auth_error=token_exchange');
      }

      const tokenData = (await tokenRes.json()) as { access_token: string };

      // Fetch user info
      const userRes = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });

      if (!userRes.ok) {
        return reply.redirect('/?auth_error=userinfo');
      }

      const user = (await userRes.json()) as { email: string; name: string };

      // Check users table
      const dbUser = await findUserByEmail(getPool(), user.email);
      if (!dbUser) return reply.redirect('/?auth_error=unauthorized');
      if (!dbUser.is_active) return reply.redirect('/?auth_error=deactivated');

      return issueJwtAndRedirect(reply, jwtSecret, dbUser, user.email, user.name);
    },
  );

  // ── Slack OAuth routes ────────────────────────────────────────────────────

  // GET /api/auth/slack — redirect to Slack OAuth
  app.get('/api/auth/slack', async (_req, reply) => {
    if (!slackClientId) {
      return reply.code(503).send({ error: 'Slack auth not configured' });
    }

    const state = crypto.randomBytes(16).toString('hex');
    reply.setCookie(STATE_COOKIE_NAME, state, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 300,
    });

    const params = new URLSearchParams({
      client_id: slackClientId,
      redirect_uri: slackCallbackUrl,
      user_scope: 'identity.basic,identity.email,identity.avatar',
      state,
    });

    return reply.redirect(`${SLACK_AUTH_URL}?${params.toString()}`);
  });

  // GET /api/auth/slack/callback
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/api/auth/slack/callback',
    async (req, reply) => {
      const { code, state, error } = req.query;

      if (error || !code || !state) {
        return reply.redirect('/?auth_error=1');
      }

      const storedState = req.cookies[STATE_COOKIE_NAME];
      reply.clearCookie(STATE_COOKIE_NAME, { path: '/' });

      if (!storedState || storedState !== state) {
        return reply.redirect('/?auth_error=invalid_state');
      }

      // Exchange code for tokens
      const tokenRes = await fetch(SLACK_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: slackClientId!,
          client_secret: slackClientSecret,
          redirect_uri: slackCallbackUrl,
        }),
      });

      const tokenData = (await tokenRes.json()) as {
        ok: boolean;
        error?: string;
        authed_user?: { access_token: string };
      };

      if (!tokenData.ok || !tokenData.authed_user?.access_token) {
        app.log.warn({ error: tokenData.error }, 'Slack OAuth token exchange failed');
        return reply.redirect('/?auth_error=token_exchange');
      }

      // Fetch user identity
      const identityRes = await fetch(SLACK_IDENTITY_URL, {
        headers: { Authorization: `Bearer ${tokenData.authed_user.access_token}` },
      });

      const identityData = (await identityRes.json()) as {
        ok: boolean;
        error?: string;
        user: { id: string; name: string; email: string; image_512?: string; image_192?: string };
        team: { id: string; name: string };
      };

      if (!identityData.ok) {
        app.log.warn({ error: identityData.error }, 'Slack identity fetch failed');
        return reply.redirect('/?auth_error=userinfo');
      }

      // Verify workspace if SLACK_ALLOWED_TEAM_ID is set
      if (slackAllowedTeamId && identityData.team.id !== slackAllowedTeamId) {
        app.log.warn(
          { teamId: identityData.team.id, email: identityData.user.email },
          'Unauthorized Slack workspace access attempt',
        );
        return reply.redirect('/?auth_error=unauthorized_workspace');
      }

      // Check users table
      const email = identityData.user.email;
      const dbUser = await findUserByEmail(getPool(), email);
      if (!dbUser) return reply.redirect('/?auth_error=unauthorized');
      if (!dbUser.is_active) return reply.redirect('/?auth_error=deactivated');

      return issueJwtAndRedirect(reply, jwtSecret, dbUser, email, identityData.user.name);
    },
  );

  // ── Common routes ─────────────────────────────────────────────────────────

  // GET /api/auth/providers — return available OAuth providers
  app.get('/api/auth/providers', async (_req, reply) => {
    return reply.send({
      google: !!googleClientId,
      slack: !!slackClientId,
    });
  });

  // GET /api/auth/status — return current auth state
  app.get('/api/auth/status', async (req, reply) => {
    if (!authConfigured) {
      return reply.send({ authenticated: true });
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
