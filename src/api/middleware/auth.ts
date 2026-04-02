import { FastifyRequest, FastifyReply } from 'fastify';
import { jwtVerify } from 'jose';
import type { UserRole } from '../../shared/types.js';

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
 * Bypass mode: if GOOGLE_CLIENT_ID is empty/unset, all requests are allowed
 * (enables development without OAuth credentials).
 */
export async function authMiddleware(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Auth routes and MCP endpoint are always accessible (MCP handles its own auth via Bearer token)
  if (req.url.startsWith('/api/auth/') || req.url.startsWith('/mcp')) return;

  // Bypass mode: no GOOGLE_CLIENT_ID → allow all requests
  const clientId = process.env['GOOGLE_CLIENT_ID'];
  if (!clientId) return;

  const token = req.cookies['atom_auth'];
  if (!token) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }

  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    req.jwtUser = {
      id: payload['id'] as string,
      email: payload['email'] as string,
      name: payload['name'] as string,
      role: (payload['role'] as UserRole) ?? 'viewer',
    };
  } catch {
    reply.code(401).send({ error: 'Invalid token' });
  }
}
