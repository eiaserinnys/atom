import { FastifyRequest, FastifyReply } from 'fastify';
import { resolveAuthMode } from '../auth-mode.js';
import { isReservedBackendPath } from '../static-dashboard.js';
import { getDb } from '../../db/client.js';
import { findUserById } from '../../db/queries/users.js';
import { extractAuthToken } from '../routes/auth_helpers.js';
import { toJwtUser, verifyAccessToken } from '../access-token.js';

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const READ_ONLY_POST_ROUTES = [
  '/tree/:nodeId/compile',
  '/tree/compile/contents',
  '/tree/:nodeId/compile/sections',
  '/search/evaluate',
  '/search/expand',
];

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
  if ((req.routeOptions.config as { publicStatic?: boolean } | undefined)?.publicStatic === true) {
    let decodedPath: string;
    try { decodedPath = decodeURIComponent((req.raw.url ?? req.url).split('?')[0]); }
    catch { reply.code(400).send({ error: 'Bad Request' }); return; }
    if (isReservedBackendPath(decodedPath)) reply.code(404).send({ error: 'Not Found' });
    return;
  }

  // Auth routes, MCP endpoint, and well-known discovery are always accessible
  // (MCP handles its own auth via Bearer token; well-known must be publicly reachable
  //  so MCP clients don't fall back to OAuth discovery)
  // /api/cards and /api/tree use agent key auth (handled in the route's own preHandler)
  if (req.url.startsWith('/api/auth/') || req.url === '/api/version' || req.url.startsWith('/mcp') || req.url.startsWith('/.well-known/') || req.url === '/register' || req.url.startsWith('/api/cards') || req.url.startsWith('/api/tree') || req.url === '/api/health') return;

  const mode = resolveAuthMode();
  if (mode === 'unconfigured') {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }
  if (mode === 'bypass') {
    req.jwtUser = { id: 'bypass', email: 'bypass@local', name: 'Bypass Admin', role: 'admin' };
    return;
  }

  const token = extractAuthToken(req);
  if (!token) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }

  const payload = await verifyAccessToken(token);
  if (!payload) {
    reply.code(401).send({ error: 'Invalid token' });
    return;
  }

  const user = await findUserById(getDb(), payload.id);
  if (!user || !user.is_active) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }
  req.jwtUser = toJwtUser(user, payload);

  if (
    user.role === 'viewer' &&
    !READ_ONLY_METHODS.has(req.method) &&
    !(req.method === 'POST' && READ_ONLY_POST_ROUTES.includes(req.routeOptions.url ?? ''))
  ) {
    reply.code(403).send({ error: 'Forbidden' });
  }
}
