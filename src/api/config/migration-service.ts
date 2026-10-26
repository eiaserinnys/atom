import type { DatabaseAdapter, Queryable } from '../../db/adapter.js';
import {
  getMigrationPreconditionError,
  parseSqliteJsonArrayField,
  toMigrationPositionKey,
} from './migration.js';

export type SqliteMigrationDatabase = {
  prepare(sql: string): { all(): Record<string, unknown>[] };
  close(): void;
};

export type ConfigMigrationServiceDeps = {
  db: DatabaseAdapter;
  getSqlitePath(): string;
  existsSync(filePath: string): boolean;
  openSqliteReadonly(sqlitePath: string): SqliteMigrationDatabase;
  renameSync(from: string, to: string): void;
};

export type ConfigMigrationResult =
  | { ok: true }
  | { ok: false; statusCode: 400 | 500; error: string };

export async function migrateSqliteToPostgres(
  deps: ConfigMigrationServiceDeps,
): Promise<ConfigMigrationResult> {
  const sqlitePath = deps.getSqlitePath();
  const sqliteFileExists = deps.db.dbType === 'postgres' ? deps.existsSync(sqlitePath) : true;
  const deprecatedFileExists =
    deps.db.dbType === 'postgres' && sqliteFileExists ? deps.existsSync(sqlitePath + '.deprecated') : false;
  const preconditionError = getMigrationPreconditionError({
    dbType: deps.db.dbType,
    sqlitePath,
    sqliteFileExists,
    deprecatedFileExists,
  });

  if (preconditionError) {
    return { ok: false, statusCode: 400, error: preconditionError };
  }

  const sqliteDb = deps.openSqliteReadonly(sqlitePath);

  try {
    await copySqliteRowsToPostgres(sqliteDb, deps.db);
    sqliteDb.close();
    deps.renameSync(sqlitePath, sqlitePath + '.deprecated');
    return { ok: true };
  } catch (err) {
    sqliteDb.close();
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, statusCode: 500, error: `Migration failed: ${message}` };
  }
}

async function copySqliteRowsToPostgres(
  sqliteDb: SqliteMigrationDatabase,
  db: DatabaseAdapter,
): Promise<void> {
  await db.transaction(async (tx) => {
    await copyUsers(sqliteDb, tx);
    await copyAgents(sqliteDb, tx);
    await copyCards(sqliteDb, tx);
    await copyTreeNodes(sqliteDb, tx);
  });
}

async function copyUsers(sqliteDb: SqliteMigrationDatabase, tx: Queryable): Promise<void> {
  const users = sqliteDb.prepare('SELECT * FROM users ORDER BY created_at').all();
  for (const u of users) {
    const conflicts = await tx.query(
      'SELECT id FROM users WHERE email = $1 AND id <> $2',
      [u['email'], u['id']],
    );
    let agentIds: unknown[] = [];
    if (conflicts.rows.length > 0) {
      // SQLite owns the user's identity. Deleting the seed sets its agents'
      // created_by to NULL; restore those references after inserting the source.
      const seedId = conflicts.rows[0]['id'];
      const agents = await tx.query('SELECT id FROM agents WHERE created_by = $1', [seedId]);
      agentIds = agents.rows.map((agent) => agent['id']);
      await tx.query('DELETE FROM users WHERE id = $1', [seedId]);
    }
    await tx.query(
      `INSERT INTO users (id, email, display_name, role, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [u['id'], u['email'], u['display_name'] ?? null, u['role'], Boolean(u['is_active']), u['created_at']],
    );
    if (agentIds.length > 0) {
      await tx.query('UPDATE agents SET created_by = $1 WHERE id = ANY($2::uuid[])', [u['id'], agentIds]);
    }
  }
}

async function copyAgents(sqliteDb: SqliteMigrationDatabase, tx: Queryable): Promise<void> {
  const agents = sqliteDb.prepare('SELECT * FROM agents ORDER BY created_at').all();
  for (const a of agents) {
    await tx.query(
      `INSERT INTO agents (id, agent_id, secret_hash, display_name, is_active, created_by, created_at, scope)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [
        a['id'],
        a['agent_id'],
        a['secret_hash'],
        a['display_name'] ?? null,
        Boolean(a['is_active']),
        a['created_by'] ?? null,
        a['created_at'],
        a['scope'] ?? 'write',
      ],
    );
  }
}

async function copyCards(sqliteDb: SqliteMigrationDatabase, tx: Queryable): Promise<void> {
  const cards = sqliteDb.prepare('SELECT * FROM cards ORDER BY card_timestamp').all();
  for (const c of cards) {
    const refs = parseSqliteJsonArrayField(c['references']);
    const tags = parseSqliteJsonArrayField(c['tags']);
    await tx.query(
      `INSERT INTO cards (id, card_type, title, content, "references", tags, card_timestamp, content_timestamp, source_type, source_ref, source_snapshot, version, updated_at, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (id) DO NOTHING`,
      [
        c['id'],
        c['card_type'],
        c['title'],
        c['content'] ?? null,
        refs,
        tags,
        c['card_timestamp'],
        c['content_timestamp'] ?? null,
        c['source_type'] ?? null,
        c['source_ref'] ?? null,
        c['source_snapshot'] ?? null,
        c['version'] ?? 1,
        c['updated_at'],
        c['created_by'] ?? null,
        c['updated_by'] ?? null,
      ],
    );
  }
}

async function copyTreeNodes(sqliteDb: SqliteMigrationDatabase, tx: Queryable): Promise<void> {
  const allNodes = sqliteDb.prepare('SELECT * FROM tree_nodes ORDER BY created_at').all();
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
      [
        nodeId,
        node['card_id'],
        node['parent_node_id'] ?? null,
        toMigrationPositionKey(node['position']),
        Boolean(node['is_symlink']),
        node['created_at'],
      ],
    );

    inserted.add(nodeId);
    const children = allNodes.filter((n) => n['parent_node_id'] === nodeId && !inserted.has(n['id'] as string));
    queue.push(...children);
  }
}
