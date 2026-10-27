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
  checkpointSqlite(sqlitePath: string): { busy: number };
  openSqliteReadonly(sqlitePath: string): SqliteMigrationDatabase;
  renameSync(from: string, to: string): void;
};

export type ConfigMigrationResult =
  | { ok: true }
  | { ok: false; statusCode: 400 | 409 | 500; error: string };

type MigrationTable = 'users' | 'agents' | 'cards' | 'tree_nodes';
type MigrationCopyCounts = Record<MigrationTable, number>;
type TreeNodeRow = Record<string, unknown>;

const migrationTables: MigrationTable[] = ['users', 'agents', 'cards', 'tree_nodes'];

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

  let checkpoint: { busy: number };
  try {
    checkpoint = deps.checkpointSqlite(sqlitePath);
  } catch (error) {
    return { ok: false, statusCode: 500, error: `Migration failed: ${errorMessage(error)}` };
  }
  if (checkpoint.busy !== 0) {
    return {
      ok: false,
      statusCode: 409,
      error: `SQLite file is in use; WAL checkpoint reported busy=${checkpoint.busy}.`,
    };
  }

  const sqliteDb = deps.openSqliteReadonly(sqlitePath);
  let copyCounts: MigrationCopyCounts;
  try {
    const sourceTreeNodes = sqliteDb.prepare('SELECT * FROM tree_nodes ORDER BY created_at').all();
    const unreachable = findUnreachableTreeNodes(sourceTreeNodes);
    if (unreachable.length > 0) {
      const ids = unreachable.slice(0, 5).map((node) => String(node['id']));
      return {
        ok: false,
        statusCode: 400,
        error: `SQLite tree contains ${unreachable.length} unreachable node(s); first IDs: ${ids.join(', ')}.`,
      };
    }

    copyCounts = await copySqliteRowsToPostgres(sqliteDb, deps.db, sourceTreeNodes.length);
  } catch (error) {
    return { ok: false, statusCode: 500, error: `Migration failed: ${errorMessage(error)}` };
  } finally {
    sqliteDb.close();
  }

  const deprecatedPath = sqlitePath + '.deprecated';
  try {
    deps.renameSync(sqlitePath, deprecatedPath);
    for (const suffix of ['-wal', '-shm']) {
      const sidecarPath = sqlitePath + suffix;
      if (deps.existsSync(sidecarPath)) {
        deps.renameSync(sidecarPath, deprecatedPath + suffix);
      }
    }

    const backupDb = deps.openSqliteReadonly(deprecatedPath);
    const mismatches: string[] = [];
    try {
      for (const table of migrationTables) {
        const rows = backupDb.prepare(`SELECT COUNT(*) AS count FROM ${table}`).all();
        const backupCount = Number(rows[0]?.['count'] ?? 0);
        if (backupCount !== copyCounts[table]) {
          mismatches.push(`${table}: copied ${copyCounts[table]}, backup ${backupCount}`);
        }
      }
    } finally {
      backupDb.close();
    }

    if (mismatches.length > 0) {
      return {
        ok: false,
        statusCode: 500,
        error: `PostgreSQL copy completed, but the SQLite backup is incomplete: ${mismatches.join('; ')}.`,
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      statusCode: 500,
      error: `PostgreSQL copy completed, but the SQLite backup is incomplete: ${errorMessage(error)}`,
    };
  }
}

async function copySqliteRowsToPostgres(
  sqliteDb: SqliteMigrationDatabase,
  db: DatabaseAdapter,
  expectedTreeNodeCount: number,
): Promise<MigrationCopyCounts> {
  return db.transaction(async (tx) => {
    const users = await copyUsers(sqliteDb, tx);
    const agents = await copyAgents(sqliteDb, tx);
    const cards = await copyCards(sqliteDb, tx);
    const treeNodes = sqliteDb.prepare('SELECT * FROM tree_nodes ORDER BY created_at').all();
    const copiedTreeNodes = await copyTreeNodes(treeNodes, tx, expectedTreeNodeCount);
    return { users, agents, cards, tree_nodes: copiedTreeNodes };
  });
}

async function copyUsers(sqliteDb: SqliteMigrationDatabase, tx: Queryable): Promise<number> {
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
  return users.length;
}

async function copyAgents(sqliteDb: SqliteMigrationDatabase, tx: Queryable): Promise<number> {
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
  return agents.length;
}

async function copyCards(sqliteDb: SqliteMigrationDatabase, tx: Queryable): Promise<number> {
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
  return cards.length;
}

async function copyTreeNodes(
  allNodes: TreeNodeRow[],
  tx: Queryable,
  expectedNodeCount: number,
): Promise<number> {
  const childrenByParent = groupNodesByParent(allNodes);
  const inserted = new Set<string>();
  const queue = [...(childrenByParent.get(null) ?? [])];

  while (queue.length > 0) {
    const node = queue.shift()!;
    const nodeId = String(node['id']);
    if (inserted.has(nodeId)) continue;

    await tx.query(
      `INSERT INTO tree_nodes (id, card_id, parent_node_id, position, is_symlink, created_at, journal_limit)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [
        nodeId,
        node['card_id'],
        node['parent_node_id'] ?? null,
        toMigrationPositionKey(node['position']),
        Boolean(node['is_symlink']),
        node['created_at'],
        node['journal_limit'] ?? null,
      ],
    );

    inserted.add(nodeId);
    queue.push(...(childrenByParent.get(nodeId) ?? []));
  }

  if (inserted.size !== expectedNodeCount) {
    throw new Error(`Copied ${inserted.size} of ${expectedNodeCount} tree nodes.`);
  }
  return inserted.size;
}

function findUnreachableTreeNodes(allNodes: TreeNodeRow[]): TreeNodeRow[] {
  const childrenByParent = groupNodesByParent(allNodes);
  const reachable = new Set<string>();
  const queue = [...(childrenByParent.get(null) ?? [])];

  while (queue.length > 0) {
    const node = queue.shift()!;
    const nodeId = String(node['id']);
    if (reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    queue.push(...(childrenByParent.get(nodeId) ?? []));
  }

  return allNodes.filter((node) => !reachable.has(String(node['id'])));
}

function groupNodesByParent(allNodes: TreeNodeRow[]): Map<string | null, TreeNodeRow[]> {
  const childrenByParent = new Map<string | null, TreeNodeRow[]>();
  for (const node of allNodes) {
    const parentId = (node['parent_node_id'] ?? null) as string | null;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(node);
    childrenByParent.set(parentId, siblings);
  }
  return childrenByParent;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
