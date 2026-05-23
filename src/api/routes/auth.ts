import { FastifyPluginAsync } from 'fastify';
import { jwtVerify } from 'jose';
import crypto from 'crypto';
import { findUserByEmail, insertUser } from '../../db/queries/users.js';
import { getDb } from '../../db/client.js';
import {
  JWT_COOKIE_NAME,
  STATE_COOKIE_NAME,
  buildBypassAuthStatus,
  buildGoogleAuthRedirectUrl,
  buildSlackAuthRedirectUrl,
  getProviderAvailability,
  getStateCookieOptions,
} from './auth_helpers.js';
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

        return handleGoogleCallback({
          deps,
          reply,
          frontendUrl,
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
