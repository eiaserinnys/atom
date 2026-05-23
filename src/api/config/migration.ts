import { posToKey } from '../../shared/lexorank.js';

export interface MigrationPreconditionInput {
  dbType: string;
  sqlitePath: string;
  sqliteFileExists: boolean;
  deprecatedFileExists: boolean;
}

export function getMigrationPreconditionError(input: MigrationPreconditionInput): string | null {
  if (input.dbType !== 'postgres') {
    return 'Current mode is not PostgreSQL. Switch to PostgreSQL first.';
  }
  if (!input.sqliteFileExists) {
    return `SQLite file not found: ${input.sqlitePath}`;
  }
  if (input.deprecatedFileExists) {
    return 'Migration already completed (.deprecated file exists).';
  }
  return null;
}

export function toMigrationPositionKey(rawPosition: unknown): string {
  // Cycle A1: position is now TEXT (zero-padded key). After SQLite
  // migration 010 the source DB also stores TEXT, but the legacy
  // path (older backups with INTEGER position) is handled by routing
  // any number through posToKey. String values pass through verbatim.
  return typeof rawPosition === 'number' ? posToKey(rawPosition) : (rawPosition as string);
}

export function parseSqliteJsonArrayField(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : (value ?? []);
}
