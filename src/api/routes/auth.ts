import { FastifyPluginAsync } from 'fastify';
import { jwtVerify } from 'jose';
import crypto from 'crypto';
import { findUserByEmail, insertUser } from '../../db/queries/users.js';
import { getDb } from '../../db/client.js';
import {
  JWT_COOKIE_NAME,
  STATE_COOKIE_NAME,
  ATOM_SEARCH_MOTION_RETURN_TO,
  buildBypassAuthStatus,
  buildGoogleAuthRedirectUrl,
  buildSlackAuthRedirectUrl,
  getSearchMotionPageUrl,
  getProviderAvailability,
  getStateCookieOptions,
  isAtomSearchMotionState,
} from './auth_helpers.js';
import { isAuthBypassEnabled } from '../auth-mode.js';
import type { AuthCallbackDeps } from './auth_callback_handlers.js';
import { handleGoogleCallback, handleSlackCallback } from './auth_callback_handlers.js';

export type AuthRoutesDeps = AuthCallbackDeps;

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
        reply.setCookie(STATE_COOKIE_NAME, state, getStateCookieOptions());

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

        return handleSlackCallback({
          deps,
          log: app.log,
          reply,
          frontendUrl,
          jwtSecret,
          code,
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
