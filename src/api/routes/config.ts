import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { getPool } from '../../db/client.js';
import {
  listUsers,
  insertUser,
  findUserById,
  updateUserRole,
  updateUserActive,
  countAdmins,
} from '../../db/queries/users.js';
import {
  listAgents,
  insertAgent,
  updateAgentActive,
  updateAgentSecret,
} from '../../db/queries/agents.js';
import type { UserRole } from '../../shared/types.js';
import type { Agent } from '../../db/queries/agents.js';

// Role hierarchy
const ROLE_LEVEL: Record<UserRole, number> = { admin: 3, editor: 2, viewer: 1 };

function requireRole(req: FastifyRequest, reply: FastifyReply, minRole: UserRole): boolean {
  const user = req.jwtUser;
  if (!user) {
    reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }
  if ((ROLE_LEVEL[user.role] ?? 0) < ROLE_LEVEL[minRole]) {
    reply.code(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

function agentToPublic(agent: Agent) {
  const { secret_hash: _secretHash, ...pub } = agent;
  return pub;
}

export const configRoutes: FastifyPluginAsync = async (app) => {
  // ── Users ─────────────────────────────────────────────────────────────────

  // GET /api/config/users — list users (admin only)
  app.get('/api/config/users', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    const users = await listUsers(getPool());
    return reply.send(users);
  });

  // POST /api/config/users — create user (admin only)
  app.post<{ Body: { email: string; display_name?: string; role: UserRole } }>(
    '/api/config/users',
    async (req, reply) => {
      if (!requireRole(req, reply, 'admin')) return;
      const { email, display_name, role } = req.body;
      if (!email || !role) {
        return reply.code(400).send({ error: 'email and role are required' });
      }
      const user = await insertUser(getPool(), { email, display_name, role });
      return reply.code(201).send(user);
    }
  );

  // PATCH /api/config/users/:id — update user role/active (admin only)
  app.patch<{
    Params: { id: string };
    Body: { role?: UserRole; is_active?: boolean };
  }>('/api/config/users/:id', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    const db = getPool();
    const { id } = req.params;
    const { role, is_active } = req.body;

    // Last admin protection
    const targetUser = await findUserById(db, id);
    if (!targetUser) return reply.code(404).send({ error: 'User not found' });

    if (targetUser.role === 'admin') {
      const demoting = role !== undefined && role !== 'admin';
      const deactivating = is_active === false;
      if ((demoting || deactivating) && (await countAdmins(db)) <= 1) {
        return reply.code(400).send({ error: 'Cannot remove the last admin' });
      }
    }

    let updated = targetUser;
    if (role !== undefined) {
      const r = await updateUserRole(db, id, role);
      if (r) updated = r;
    }
    if (is_active !== undefined) {
      const r = await updateUserActive(db, id, is_active);
      if (r) updated = r;
    }
    return reply.send(updated);
  });

  // ── Agents ────────────────────────────────────────────────────────────────

  // GET /api/config/agents — list agents (admin or editor)
  app.get('/api/config/agents', async (req, reply) => {
    if (!requireRole(req, reply, 'editor')) return;
    const agents = await listAgents(getPool());
    return reply.send(agents.map(agentToPublic));
  });

  // POST /api/config/agents — create agent (admin or editor), returns secret once
  app.post<{ Body: { agent_id: string; display_name?: string } }>(
    '/api/config/agents',
    async (req, reply) => {
      if (!requireRole(req, reply, 'editor')) return;
      const { agent_id, display_name } = req.body;
      if (!agent_id) {
        return reply.code(400).send({ error: 'agent_id is required' });
      }

      const plainSecret = randomBytes(32).toString('hex');
      const secretHash = await bcrypt.hash(plainSecret, 10);
      const agent = await insertAgent(getPool(), {
        agent_id,
        secret_hash: secretHash,
        display_name,
        created_by: req.jwtUser!.id,
      });
      return reply.code(201).send({
        ...agentToPublic(agent),
        secret: plainSecret,
      });
    }
  );

  // POST /api/config/agents/:id/reissue — reissue secret (admin or editor)
  app.post<{ Params: { id: string } }>(
    '/api/config/agents/:id/reissue',
    async (req, reply) => {
      if (!requireRole(req, reply, 'editor')) return;
      const { id } = req.params;

      const plainSecret = randomBytes(32).toString('hex');
      const secretHash = await bcrypt.hash(plainSecret, 10);
      const agent = await updateAgentSecret(getPool(), id, secretHash);
      if (!agent) return reply.code(404).send({ error: 'Agent not found' });

      return reply.send({
        ...agentToPublic(agent),
        secret: plainSecret,
      });
    }
  );

  // PATCH /api/config/agents/:id — update agent (admin or editor)
  app.patch<{
    Params: { id: string };
    Body: { is_active?: boolean };
  }>('/api/config/agents/:id', async (req, reply) => {
    if (!requireRole(req, reply, 'editor')) return;
    const db = getPool();
    const { id } = req.params;
    const { is_active } = req.body;

    if (is_active === undefined) {
      return reply.code(400).send({ error: 'No updatable fields provided' });
    }
    const agent = await updateAgentActive(db, id, is_active);
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });
    return reply.send(agentToPublic(agent));
  });
};
