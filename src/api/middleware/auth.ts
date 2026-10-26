import { FastifyRequest, FastifyReply } from 'fastify';
import { jwtVerify, type JWTPayload } from 'jose';
import type { UserRole } from '../../shared/types.js';
import { isAuthBypassEnabled } from '../auth-mode.js';
import { getDb } from '../../db/client.js';
import { findUserById } from '../../db/queries/users.js';

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const READ_ONLY_POST_ROUTES = ['/tree/:nodeId/compile', '/search/evaluate', '/search/expand'];

// Module-level lazy init to avoid re-creating on every request
let _jwtSecret: Uint8Array | null = null;

function getJwtSecret(): Uint8Array {
  if (!_jwtSecret) {
    _jwtSecret = new TextEncoder().encode(process.env['JWT_SECRET']!);
  }
  return _jwtSecret;
}

/**
 * Fastify preHandler hook — enforces JWT authentication.
 *
 * NOTE: This middleware runs at the Fastify level, not at nginx level.
 * It applies to ALL Fastify routes regardless of how nginx routes requests.
 * Auth routes (/api/auth/*) are explicitly exempted below.
 *
 * Bypass mode requires AUTH_BYPASS=1 and no configured OAuth provider.
 */
export async function authMiddleware(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Auth routes, MCP endpoint, and well-known discovery are always accessible
  // (MCP handles its own auth via Bearer token; well-known must be publicly reachable
  //  so MCP clients don't fall back to OAuth discovery)
  // /api/cards and /api/tree use agent key auth (handled in the route's own preHandler)
  if (req.url.startsWith('/api/auth/') || req.url === '/api/version' || req.url.startsWith('/mcp') || req.url.startsWith('/.well-known/') || req.url === '/register' || req.url.startsWith('/api/cards') || req.url.startsWith('/api/tree') || req.url === '/api/health') return;

  // Without a login provider, only explicit local bypass can authenticate browser APIs.
  const googleClientId = process.env['GOOGLE_CLIENT_ID'];
  const slackClientId = process.env['SLACK_CLIENT_ID'];
  if (!googleClientId && !slackClientId) {
    if (!isAuthBypassEnabled()) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    req.jwtUser = { id: 'bypass', email: 'bypass@local', name: 'Bypass Admin', role: 'admin' };
    return;
  }

  const token = req.cookies['atom_auth'];
  if (!token) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, getJwtSecret()));
  } catch {
    reply.code(401).send({ error: 'Invalid token' });
    return;
  }

  const userId = payload['id'];
  if (typeof userId !== 'string') {
    reply.code(401).send({ error: 'Invalid token' });
    return;
  }
  const user = await findUserById(getDb(), userId);
  if (!user || !user.is_active) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }
  req.jwtUser = {
    id: user.id,
    email: user.email,
    name: user.display_name ?? (typeof payload['name'] === 'string' ? payload['name'] : ''),
    role: user.role as UserRole,
  };

  if (
    user.role === 'viewer' &&
    !READ_ONLY_METHODS.has(req.method) &&
    !(req.method === 'POST' && READ_ONLY_POST_ROUTES.includes(req.routeOptions.url ?? ''))
  ) {
    reply.code(403).send({ error: 'Forbidden' });
  }
}
