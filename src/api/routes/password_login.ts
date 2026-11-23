import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { SignJWT } from 'jose';
import { getDb } from '../../db/client.js';
import { ensurePasswordAdminUser } from '../../db/queries/users.js';
import { getDashboardAdminPassword, resolveAuthMode } from '../auth-mode.js';
import { createLoginRateLimiter } from '../login-rate-limit.js';
import { JWT_COOKIE_NAME, JWT_EXPIRY_SECONDS } from './auth_helpers.js';

const defaultDeps = { getDb, ensurePasswordAdminUser, now: Date.now };
type PasswordLoginDeps = typeof defaultDeps & { limiter: ReturnType<typeof createLoginRateLimiter> };

export function isHttpsRequest(req: FastifyRequest): boolean {
  const header = req.headers['x-forwarded-proto'];
  if (header !== undefined) {
    const first = Array.isArray(header) ? header[0] : header;
    return first.split(',')[0].trim().toLowerCase() === 'https';
  }
  return req.protocol === 'https';
}

export function createPasswordLoginRoutes(
  deps: PasswordLoginDeps = { ...defaultDeps, limiter: createLoginRateLimiter({ now: defaultDeps.now }) },
): FastifyPluginAsync {
  return async (app) => {
    app.post('/api/auth/password-login', async (req, reply) => {
      if (resolveAuthMode() !== 'password') return reply.code(404).send({ error: 'Not Found' });
      const limit = deps.limiter.check(req.ip);
      if (limit.blocked) {
        return reply.header('Retry-After', String(limit.retryAfterSec)).code(429).send({ error: 'Too many login attempts' });
      }
      const password = (req.body as { password?: unknown } | null)?.password;
      if (typeof password !== 'string') return reply.code(400).send({ error: 'Invalid request' });
      const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest();
      if (!timingSafeEqual(hash(password), hash(getDashboardAdminPassword()!))) {
        deps.limiter.recordFailure(req.ip);
        return reply.code(401).send({ error: 'Invalid password' });
      }
      deps.limiter.reset(req.ip);
      const user = await deps.ensurePasswordAdminUser(deps.getDb());
      if (!user.is_active) return reply.code(403).send({ error: 'Account disabled' });
      const token = await new SignJWT({ id: user.id, email: user.email, name: user.display_name, role: user.role, typ: 'access' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(`${JWT_EXPIRY_SECONDS}s`)
        .sign(new TextEncoder().encode(process.env['JWT_SECRET']!));
      reply.setCookie(JWT_COOKIE_NAME, token, {
        httpOnly: true, sameSite: 'lax', path: '/', maxAge: JWT_EXPIRY_SECONDS, secure: isHttpsRequest(req),
      });
      return reply.send({ ok: true });
    });
  };
}

export const passwordLoginRoutes = createPasswordLoginRoutes();
