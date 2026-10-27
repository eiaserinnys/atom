import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function loadConfig(databaseUrl?: string, workspace?: string) {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.ATOM_E2E_DIR;
  if (databaseUrl !== undefined) env.DATABASE_URL = databaseUrl;
  if (workspace !== undefined) env.ATOM_E2E_DIR = workspace;
  // Importing the config does not run Playwright or start either web server.
  return spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    "const {default:c}=await import('./playwright.config.ts'); console.log(JSON.stringify(c.webServer));"],
  { cwd: process.cwd(), env, encoding: 'utf8', timeout: 120_000 });
}

test('E2E fails before startup when DATABASE_URL is inherited', () => {
  const result = loadConfig('postgresql://invalid/forbidden_test_db');
  expect(result.error).toBeUndefined();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('DATABASE_URL');
}, 130_000);

test('E2E rejects a checkout supplied as the disposable workspace', () => {
  const result = loadConfig(undefined, process.cwd());
  expect(result.error).toBeUndefined();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('ATOM_E2E_DIR must be a disposable workspace');
}, 130_000);

test('E2E server source, SQLite and .env all live in a disposable directory', () => {
  const result = loadConfig();
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  const [api] = JSON.parse(result.stdout.trim());
  expect(api.cwd).toEqual(expect.any(String));
  expect(api.cwd.startsWith(path.join(fs.realpathSync(os.tmpdir()), 'atom-e2e-'))).toBe(true);
  try {
    expect(api.env.SQLITE_PATH).toBe(path.join(api.cwd, 'atom.db'));
    expect(fs.existsSync(path.join(api.cwd, 'src/api/index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(api.cwd, '.env'))).toBe(true);
    expect(api.env.DATABASE_URL).toBeUndefined();
  } finally {
    fs.rmSync(api.cwd, { recursive: true, force: true });
  }
}, 130_000);

test('local database, migration leftovers and env variants stay out of git', () => {
  const files = ['atom.db', 'atom.db-wal', 'atom.db-shm', 'atom.db.deprecated', '.env.local', '.env.test'];
  const result = spawnSync('git', ['check-ignore', '--stdin'], {
    input: files.join('\n'), encoding: 'utf8', timeout: 5000,
  });
  expect(result.stdout.trim().split('\n')).toEqual(files);
  expect(spawnSync('git', ['check-ignore', '--no-index', '.env.example'], { timeout: 5000 }).status).toBe(1);
});
