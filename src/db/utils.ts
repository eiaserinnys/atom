import { getDb } from "./client.js";

/**
 * Serialize a string array for DB storage.
 * PostgreSQL accepts native arrays; SQLite stores them as JSON strings.
 */
export function serializeArray(arr: string[]): string[] | string {
  return getDb().dbType === "sqlite" ? JSON.stringify(arr) : arr;
}

/**
 * Deserialize a value from the DB back to a string array.
 * PostgreSQL returns native arrays; SQLite returns JSON strings.
 */
export function deserializeArray(val: unknown): string[] {
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    try {
      return JSON.parse(val);
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Deserialize a boolean value from the DB.
 * PostgreSQL returns native booleans; SQLite returns 0/1 integers.
 */
export function deserializeBoolean(val: unknown): boolean {
  if (typeof val === "boolean") return val;
  return val === 1 || val === true;
}
