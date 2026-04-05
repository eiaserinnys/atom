import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { getDb } from '../../db/client.js';
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
    const users = await listUsers(getDb());
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
      const user = await insertUser(getDb(), { email, display_name, role });
      return reply.code(201).send(user);
    }
  );

  // PATCH /api/config/users/:id — update user role/active (admin only)
  app.patch<{
    Params: { id: string };
    Body: { role?: UserRole; is_active?: boolean };
  }>('/api/config/users/:id', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    const db = getDb();
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
    const agents = await listAgents(getDb());
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
      const agent = await insertAgent(getDb(), {
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
      const agent = await updateAgentSecret(getDb(), id, secretHash);
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
    const db = getDb();
    const { id } = req.params;
    const { is_active } = req.body;

    if (is_active === undefined) {
      return reply.code(400).send({ error: 'No updatable fields provided' });
    }
    const agent = await updateAgentActive(db, id, is_active);
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });
    return reply.send(agentToPublic(agent));
  });

  // ── Database Info ─────────────────────────────────────────────────────────

  // GET /api/config/db-info — current DB mode & SQLite file status (editor+)
  app.get('/api/config/db-info', async (req, reply) => {
    if (!requireRole(req, reply, 'editor')) return;
    const db = getDb();
    const sqlitePath = process.env['SQLITE_PATH'] ?? path.join(process.cwd(), 'atom.db');
    return reply.send({
      dbType: db.dbType,
      sqliteFile: sqlitePath,
      sqliteFileExists: fs.existsSync(sqlitePath),
      deprecatedFileExists: fs.existsSync(sqlitePath + '.deprecated'),
    });
  });

  // POST /api/config/migrate-to-pg — one-shot SQLite → PostgreSQL migration (admin only)
  app.post('/api/config/migrate-to-pg', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    const db = getDb();

    // Preconditions
    if (db.dbType !== 'postgres') {
      return reply.code(400).send({ error: 'Current mode is not PostgreSQL. Switch to PostgreSQL first.' });
    }
    const sqlitePath = process.env['SQLITE_PATH'] ?? path.join(process.cwd(), 'atom.db');
    if (!fs.existsSync(sqlitePath)) {
      return reply.code(400).send({ error: `SQLite file not found: ${sqlitePath}` });
    }
    if (fs.existsSync(sqlitePath + '.deprecated')) {
      return reply.code(400).send({ error: 'Migration already completed (.deprecated file exists).' });
    }

    // Open SQLite read-only
    const sqliteDb = new Database(sqlitePath, { readonly: true });

    try {
      await db.transaction(async (tx) => {
        // 1. users
        const users = sqliteDb.prepare('SELECT * FROM users ORDER BY created_at').all() as Record<string, unknown>[];
        for (const u of users) {
          await tx.query(
            `INSERT INTO users (id, email, display_name, role, is_active, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (id) DO NOTHING`,
            [u['id'], u['email'], u['display_name'] ?? null, u['role'], Boolean(u['is_active']), u['created_at']]
          );
        }

        // 2. agents
        const agents = sqliteDb.prepare('SELECT * FROM agents ORDER BY created_at').all() as Record<string, unknown>[];
        for (const a of agents) {
          await tx.query(
            `INSERT INTO agents (id, agent_id, secret_hash, display_name, is_active, created_by, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (id) DO NOTHING`,
            [a['id'], a['agent_id'], a['secret_hash'], a['display_name'] ?? null, Boolean(a['is_active']), a['created_by'] ?? null, a['created_at']]
          );
        }

        // 3. cards
        const cards = sqliteDb.prepare('SELECT * FROM cards ORDER BY card_timestamp').all() as Record<string, unknown>[];
        for (const c of cards) {
          const refs = typeof c['references'] === 'string' ? JSON.parse(c['references'] as string) : (c['references'] ?? []);
          const tags = typeof c['tags'] === 'string' ? JSON.parse(c['tags'] as string) : (c['tags'] ?? []);
          await tx.query(
            `INSERT INTO cards (id, card_type, title, content, "references", tags, card_timestamp, content_timestamp, source_type, source_ref, source_snapshot, source_checksum, source_checked_at, staleness, version, updated_at, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
             ON CONFLICT (id) DO NOTHING`,
            [
              c['id'], c['card_type'], c['title'], c['content'] ?? null,
              refs, tags,
              c['card_timestamp'], c['content_timestamp'] ?? null,
              c['source_type'] ?? null, c['source_ref'] ?? null,
              c['source_snapshot'] ?? null, c['source_checksum'] ?? null,
              c['source_checked_at'] ?? null, c['staleness'] ?? 'unverified',
              c['version'] ?? 1, c['updated_at'],
              c['created_by'] ?? null, c['updated_by'] ?? null,
            ]
          );
        }

        // 4. tree_nodes (BFS order to satisfy FK constraints)
        const allNodes = sqliteDb.prepare('SELECT * FROM tree_nodes ORDER BY created_at').all() as Record<string, unknown>[];
        const inserted = new Set<string>();
        const queue = allNodes.filter((n) => n['parent_node_id'] === null);
        while (queue.length > 0) {
          const node = queue.shift()!;
          const nodeId = node['id'] as string;
          if (inserted.has(nodeId)) continue;
          await tx.query(
            `INSERT INTO tree_nodes (id, card_id, parent_node_id, position, is_symlink, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (id) DO NOTHING`,
            [nodeId, node['card_id'], node['parent_node_id'] ?? null, node['position'], Boolean(node['is_symlink']), node['created_at']]
          );
          inserted.add(nodeId);
          const children = allNodes.filter((n) => n['parent_node_id'] === nodeId && !inserted.has(n['id'] as string));
          queue.push(...children);
        }
      });

      // Rename SQLite file to .deprecated
      sqliteDb.close();
      fs.renameSync(sqlitePath, sqlitePath + '.deprecated');

      return reply.send({ ok: true, message: 'Migration completed. SQLite file renamed to .deprecated.' });
    } catch (err) {
      sqliteDb.close();
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: `Migration failed: ${message}` });
    }
  });
};
