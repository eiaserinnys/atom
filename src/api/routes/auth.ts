import { FastifyPluginAsync } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import crypto from 'crypto';
import { findUserByEmail } from '../../db/queries/users.js';
import { getPool } from '../../db/client.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

const JWT_COOKIE_NAME = 'atom_auth';
const STATE_COOKIE_NAME = 'atom_oauth_state';
const JWT_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days

export const authRoutes: FastifyPluginAsync = async (app) => {
  const clientId = process.env['GOOGLE_CLIENT_ID'];
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET']!;
  const callbackUrl = process.env['GOOGLE_CALLBACK_URL']!;
  const jwtSecret = new TextEncoder().encode(process.env['JWT_SECRET']!);

  // GET /api/auth/google — redirect to Google OAuth
  app.get('/api/auth/google', async (req, reply) => {
    if (!clientId) {
      return reply.code(503).send({ error: 'Auth not configured' });
    }

    const state = crypto.randomBytes(16).toString('hex');
    reply.setCookie(STATE_COOKIE_NAME, state, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 300, // 5 minutes
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: 'openid email profile',
      state,
    });

    return reply.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
  });

  // GET /api/auth/google/callback — handle OAuth callback
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
          client_id: clientId!,
          client_secret: clientSecret,
          redirect_uri: callbackUrl,
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

      // Issue JWT with id, email, name, role
      const token = await new SignJWT({
        id: dbUser.id,
        email: user.email,
        name: user.name,
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
    },
  );

  // GET /api/auth/status — return current auth state
  app.get('/api/auth/status', async (req, reply) => {
    if (!clientId) {
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
