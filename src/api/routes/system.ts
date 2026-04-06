import { FastifyPluginAsync } from 'fastify';
import { getPendingRestart, setPendingRestart } from '../state.js';

function requireAdmin(req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply): boolean {
  const user = req.jwtUser;
  if (!user) {
    reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }
  if (user.role !== 'admin') {
    reply.code(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

export const systemRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/health — no auth required (exempted in authMiddleware)
  app.get('/api/health', async (_req, reply) => {
    return reply.send({ status: 'ok' });
  });

  // GET /api/system/status — admin only
  app.get('/api/system/status', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return reply.send({ pendingRestart: getPendingRestart() });
  });

  // POST /api/system/restart — admin only
  // Responds immediately, then exits after a short delay so the response is delivered.
  // The process manager (pm2) is expected to restart the process.
  app.post('/api/system/restart', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    setPendingRestart(false);
    reply.send({ ok: true });
    setTimeout(() => {
      console.log('[system] Restarting server via process.exit(0)...');
      process.exit(0);
    }, 2000);
  });
};
