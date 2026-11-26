import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { SignJWT } from 'jose';
import { getDb } from '../../db/client.js';
import { ensurePasswordAdminUser, findUserById, type User } from '../../db/queries/users.js';
import { matchesAdminPassword, passwordSessionBinding, saveAdminPassword, validateNewPassword } from '../admin-password.js';
import { resolveAuthMode } from '../auth-mode.js';
import { verifyAccessToken } from '../access-token.js';
import { createLoginRateLimiter } from '../login-rate-limit.js';
import { closeUserEventConnections } from './events.js';
import { JWT_COOKIE_NAME, JWT_EXPIRY_SECONDS, extractAuthToken } from './auth_helpers.js';

const defaultDeps = { getDb, ensurePasswordAdminUser, findUserById, now: Date.now };
type PasswordLoginDeps = typeof defaultDeps & { limiter: ReturnType<typeof createLoginRateLimiter> };

export function isHttpsRequest(req: FastifyRequest): boolean {
  const header = req.headers['x-forwarded-proto'];
  if (header !== undefined) {
    const first = Array.isArray(header) ? header[0] : header;
    return first.split(',')[0].trim().toLowerCase() === 'https';
  }
  return req.protocol === 'https';
}

async function setSessionCookie(
  reply: FastifyReply, req: FastifyRequest, user: Pick<User, 'id' | 'email' | 'display_name' | 'role'>, password: string,
): Promise<void> {
  const token = await new SignJWT({
    id: user.id, email: user.email, name: user.display_name, role: user.role, typ: 'access', pwf: passwordSessionBinding(password),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${JWT_EXPIRY_SECONDS}s`)
    .sign(new TextEncoder().encode(process.env['JWT_SECRET']!));
  reply.setCookie(JWT_COOKIE_NAME, token, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: JWT_EXPIRY_SECONDS, secure: isHttpsRequest(req),
  });
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
      if (!matchesAdminPassword(password)) {
        deps.limiter.recordFailure(req.ip);
        return reply.code(401).send({ error: 'Invalid password' });
      }
      deps.limiter.reset(req.ip);
      const user = await deps.ensurePasswordAdminUser(deps.getDb());
      if (!user.is_active) return reply.code(403).send({ error: 'Account disabled' });
      await setSessionCookie(reply, req, user, password);
      return reply.send({ ok: true });
    });

    app.post('/api/auth/password', async (req, reply) => {
      if (resolveAuthMode() !== 'password') return reply.code(404).send({ error: 'Not Found' });
      const token = extractAuthToken(req);
      const payload = token ? await verifyAccessToken(token) : null;
      const user = payload ? await deps.findUserById(deps.getDb(), payload.id) : null;
      if (!user?.is_active) return reply.code(401).send({ error: 'Unauthorized' });
      if (user.role !== 'admin') return reply.code(403).send({ error: 'Forbidden' });

      const limit = deps.limiter.check(req.ip);
      if (limit.blocked) {
        return reply.header('Retry-After', String(limit.retryAfterSec)).code(429).send({ error: 'Too many login attempts' });
      }
      const body = req.body as { current_password?: unknown; new_password?: unknown } | null;
      const current = body?.current_password;
      const next = body?.new_password;
      if (typeof current !== 'string') {
        return reply.code(400).send({ error: 'current_password must be a string', code: 'INVALID_INPUT' });
      }
      const invalid = validateNewPassword(next);
      if (invalid) return reply.code(400).send({ error: invalid, code: 'INVALID_INPUT' });
      if (!matchesAdminPassword(current)) {
        deps.limiter.recordFailure(req.ip);
        return reply.code(401).send({ error: 'Current password is incorrect', code: 'INVALID_CURRENT_PASSWORD' });
      }
      try {
        saveAdminPassword(next as string);
      } catch (error) {
        req.log.error({ code: (error as NodeJS.ErrnoException).code }, 'Could not save the admin password');
        return reply.code(500).send({ error: 'Could not write the env file', code: 'ENV_FILE_WRITE_FAILED' });
      }
      deps.limiter.reset(req.ip);
      closeUserEventConnections(user.id);
      await setSessionCookie(reply, req, user, next as string);
      return reply.send({ ok: true });
    });
  };
}

export const passwordLoginRoutes = createPasswordLoginRoutes();
