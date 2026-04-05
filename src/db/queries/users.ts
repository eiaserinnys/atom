import type { Queryable } from '../queryable.js';
import { deserializeBoolean } from '../utils.js';

export type UserRole = 'admin' | 'editor' | 'viewer';

export interface User {
  id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

function rowToUser(row: Record<string, unknown>): User {
  return {
    id: row["id"] as string,
    email: row["email"] as string,
    display_name: (row["display_name"] as string | null) ?? null,
    role: row["role"] as UserRole,
    is_active: deserializeBoolean(row["is_active"]),
    created_at: row["created_at"] as string,
  };
}

export async function findUserByEmail(
  db: Queryable, email: string
): Promise<User | null> {
  const result = await db.query(
    `SELECT * FROM users WHERE email = $1`,
    [email]
  );
  if (result.rows.length === 0) return null;
  return rowToUser(result.rows[0]);
}

/**
 * Check if an email matches the ALLOWED_EMAIL pattern.
 * Supports exact match ("user@example.com") or domain match ("@example.com").
 */
export function isEmailAllowed(email: string, allowedEmail: string | undefined): boolean {
  if (!allowedEmail) return false;
  if (allowedEmail.startsWith('@')) {
    return email.endsWith(allowedEmail);
  }
  return email === allowedEmail;
}

export async function findUserById(
  db: Queryable, id: string
): Promise<User | null> {
  const result = await db.query(
    `SELECT * FROM users WHERE id = $1`,
    [id]
  );
  if (result.rows.length === 0) return null;
  return rowToUser(result.rows[0]);
}

export async function insertUser(
  db: Queryable,
  input: { email: string; display_name?: string; role: UserRole; }
): Promise<User> {
  const id = crypto.randomUUID();
  const result = await db.query(
    `INSERT INTO users (id, email, display_name, role)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [id, input.email, input.display_name ?? null, input.role]
  );
  return rowToUser(result.rows[0]);
}

export async function listUsers(db: Queryable): Promise<User[]> {
  const result = await db.query(
    `SELECT * FROM users ORDER BY created_at ASC`
  );
  return result.rows.map(rowToUser);
}

export async function updateUserRole(
  db: Queryable, id: string, role: UserRole
): Promise<User | null> {
  const result = await db.query(
    `UPDATE users SET role = $1 WHERE id = $2 RETURNING *`,
    [role, id]
  );
  if (result.rows.length === 0) return null;
  return rowToUser(result.rows[0]);
}

export async function updateUserActive(
  db: Queryable, id: string, isActive: boolean
): Promise<User | null> {
  const result = await db.query(
    `UPDATE users SET is_active = $1 WHERE id = $2 RETURNING *`,
    [isActive, id]
  );
  if (result.rows.length === 0) return null;
  return rowToUser(result.rows[0]);
}

export async function userExists(db: Queryable): Promise<boolean> {
  const result = await db.query(`SELECT 1 FROM users LIMIT 1`);
  return (result.rowCount ?? 0) > 0;
}

export async function countAdmins(db: Queryable): Promise<number> {
  const result = await db.query(
    `SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin' AND is_active = TRUE`
  );
  return parseInt(result.rows[0]['cnt'], 10);
}
