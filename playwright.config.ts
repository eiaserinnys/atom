import { defineConfig } from '@playwright/test';
import { cpSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Fail before creating fixtures or starting servers; never inherit a real DB.
if (process.env.DATABASE_URL !== undefined) {
  throw new Error('Unset DATABASE_URL before running E2E tests. E2E uses disposable SQLite only.');
}
const repoDir = path.dirname(fileURLToPath(import.meta.url));
const tempRoot = realpathSync(tmpdir());
// Workers re-evaluate this config; share one disposable workspace with them.
if (!process.env.ATOM_E2E_DIR) {
  const dir = mkdtempSync(path.join(tempRoot, 'atom-e2e-'));
  cpSync(path.join(repoDir, 'src'), path.join(dir, 'src'), { recursive: true });
  symlinkSync(path.join(repoDir, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
  writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  writeFileSync(path.join(dir, '.env'), '');
  writeFileSync(path.join(dir, '.atom-e2e'), repoDir);
  process.env.ATOM_E2E_DIR = dir;
}
const testDir = process.env.ATOM_E2E_DIR;
// Validate the inherited path before either resetting files or cleaning it up.
if (!testDir.startsWith(path.join(tempRoot, 'atom-e2e-')) ||
    realpathSync(testDir) !== testDir ||
    readFileSync(path.join(testDir, '.atom-e2e'), 'utf8') !== repoDir) {
  throw new Error('ATOM_E2E_DIR must be a disposable workspace created by this E2E config.');
}

// Use non-production ports to avoid interfering with any running services.
// Use 127.0.0.1 explicitly — Fastify binds to 0.0.0.0 (IPv4),
// and "localhost" may resolve to ::1 (IPv6) on some systems.
const TEST_API_PORT = '14200';
const TEST_API_HOST = '127.0.0.1';
const TEST_FRONTEND_PORT = 15173;

export default defineConfig({
  testDir: './e2e',
  outputDir: path.join(testDir, 'test-results'),
  timeout: 60_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  globalTeardown: './e2e/teardown.ts',
  use: {
    baseURL: `http://${TEST_API_HOST}:${TEST_FRONTEND_PORT}`,
    headless: true,
  },
  webServer: [
    {
      command: 'node --import tsx src/api/index.ts',
      cwd: testDir,
      url: `http://${TEST_API_HOST}:${TEST_API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        API_PORT: TEST_API_PORT,
        SQLITE_PATH: path.join(testDir, 'atom.db'),
        FRONTEND_URL: `http://${TEST_API_HOST}:${TEST_FRONTEND_PORT}`,
        JWT_SECRET: 'e2e-test-secret',
        NODE_ENV: 'test',
        // Test-only local bypass is explicit; never copy this environment to a public server.
        AUTH_BYPASS: '1',
        GOOGLE_CLIENT_ID: '',
        SLACK_CLIENT_ID: '',
      },
    },
    {
      command: `node node_modules/vite/bin/vite.js --port ${TEST_FRONTEND_PORT} --host ${TEST_API_HOST}`,
      cwd: './dashboard',
      url: `http://${TEST_API_HOST}:${TEST_FRONTEND_PORT}`,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        VITE_API_BASE_URL: `http://${TEST_API_HOST}:${TEST_API_PORT}`,
      },
    },
  ],
});
