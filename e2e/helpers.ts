import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

/** Delete SQLite DB file to reset to fresh state */
export function resetTestDb(): void {
  const dbPath = path.join(PROJECT_ROOT, 'atom.db');
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  // Also remove WAL/SHM if they exist
  for (const suffix of ['-wal', '-shm']) {
    const p = dbPath + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
