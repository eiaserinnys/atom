import type { Queryable } from '../queryable.js';

export type UserRole = 'admin' | 'editor' | 'viewer';

export interface User {
  id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

export async function findUserByEmail(
  db: Queryable, email: string
): Promise<User | null> {
  const result = await db.query(
    `SELECT * FROM users WHERE email = $1`,
    [email]
  );
  return result.rows[0] ?? null;
}

export async function findUserById(
  db: Queryable, id: string
): Promise<User | null> {
  const result = await db.query(
    `SELECT * FROM users WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function insertUser(
  db: Queryable,
  input: { email: string; display_name?: string; role: UserRole; }
): Promise<User> {
  const result = await db.query(
    `INSERT INTO users (email, display_name, role)
     VALUES ($1, $2, $3) RETURNING *`,
    [input.email, input.display_name ?? null, input.role]
  );
  return result.rows[0];
}

export async function listUsers(db: Queryable): Promise<User[]> {
  const result = await db.query(
    `SELECT * FROM users ORDER BY created_at ASC`
  );
  return result.rows;
}

export async function updateUserRole(
  db: Queryable, id: string, role: UserRole
): Promise<User | null> {
  const result = await db.query(
    `UPDATE users SET role = $1 WHERE id = $2 RETURNING *`,
    [role, id]
  );
  return result.rows[0] ?? null;
}

export async function updateUserActive(
  db: Queryable, id: string, isActive: boolean
): Promise<User | null> {
  const result = await db.query(
    `UPDATE users SET is_active = $1 WHERE id = $2 RETURNING *`,
    [isActive, id]
  );
  return result.rows[0] ?? null;
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
