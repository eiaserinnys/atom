import type { Queryable } from '../queryable.js';
import { deserializeBoolean } from '../utils.js';

export interface Agent {
  id: string;
  agent_id: string;
  secret_hash: string;
  display_name: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}

function rowToAgent(row: Record<string, unknown>): Agent {
  return {
    id: row["id"] as string,
    agent_id: row["agent_id"] as string,
    secret_hash: row["secret_hash"] as string,
    display_name: (row["display_name"] as string | null) ?? null,
    is_active: deserializeBoolean(row["is_active"]),
    created_by: (row["created_by"] as string | null) ?? null,
    created_at: row["created_at"] as string,
  };
}

export async function findAgentByAgentId(
  db: Queryable, agentId: string
): Promise<Agent | null> {
  const result = await db.query(
    `SELECT * FROM agents WHERE agent_id = $1`,
    [agentId]
  );
  if (result.rows.length === 0) return null;
  return rowToAgent(result.rows[0]);
}

export async function insertAgent(
  db: Queryable,
  input: { agent_id: string; secret_hash: string; display_name?: string; created_by?: string; }
): Promise<Agent> {
  const id = crypto.randomUUID();
  const result = await db.query(
    `INSERT INTO agents (id, agent_id, secret_hash, display_name, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [id, input.agent_id, input.secret_hash, input.display_name ?? null, input.created_by ?? null]
  );
  return rowToAgent(result.rows[0]);
}

export async function listAgents(db: Queryable): Promise<Agent[]> {
  const result = await db.query(
    `SELECT * FROM agents ORDER BY created_at ASC`
  );
  return result.rows.map(rowToAgent);
}

export async function updateAgentActive(
  db: Queryable, id: string, isActive: boolean
): Promise<Agent | null> {
  const result = await db.query(
    `UPDATE agents SET is_active = $1 WHERE id = $2 RETURNING *`,
    [isActive, id]
  );
  if (result.rows.length === 0) return null;
  return rowToAgent(result.rows[0]);
}

export async function updateAgentSecret(
  db: Queryable, id: string, secretHash: string
): Promise<Agent | null> {
  const result = await db.query(
    `UPDATE agents SET secret_hash = $1 WHERE id = $2 RETURNING *`,
    [secretHash, id]
  );
  if (result.rows.length === 0) return null;
  return rowToAgent(result.rows[0]);
}

export async function findActiveAgents(db: Queryable): Promise<Agent[]> {
  const result = await db.query(
    `SELECT * FROM agents WHERE is_active = true`
  );
  return result.rows.map(rowToAgent);
}

export async function agentExists(db: Queryable): Promise<boolean> {
  const result = await db.query(`SELECT 1 FROM agents LIMIT 1`);
  return (result.rowCount ?? 0) > 0;
}
