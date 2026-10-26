import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { createConnection } from 'node:net';
import path from 'node:path';
import Database from 'better-sqlite3';

// Exercise the real startup path in a foreground-owned child with a fresh env and DB.
// Other route integration tests use Fastify directly and cannot cover listen/seed.
let child: ChildProcess | undefined;
let directory: string;

beforeEach(() => { directory = mkdtempSync(path.join(tmpdir(), 'atom-auth-startup-test-')); });
afterEach(async () => {
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
  child = undefined;
  rmSync(directory, { recursive: true, force: true });
});

async function startServer(allowedEmail: string, bypass: boolean) {
  expect(existsSync(path.resolve('.env'))).toBe(false);
  const sqlitePath = path.join(directory, 'startup-test.db');
  child = spawn(process.execPath, ['--import', 'tsx', 'src/api/index.ts'], {
    cwd: process.cwd(),
    env: {
      PATH: process.env['PATH'], NODE_ENV: 'test', API_PORT: '0',
      SQLITE_PATH: sqlitePath, ALLOWED_EMAIL: allowedEmail,
      ...(bypass ? { AUTH_BYPASS: '1' } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  const address = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Startup timeout: ${logs}`)), 15000);
    const onExit = (code: number | null) => {
      clearTimeout(timer);
      reject(new Error(`Startup exited ${code}: ${logs}`));
    };
    child!.once('exit', onExit);
    const onData = (chunk: Buffer) => {
      logs += chunk.toString();
      const match = logs.match(/Server listening at (http:\/\/[^"\s]+)/);
      if (match) {
        clearTimeout(timer);
        child!.off('exit', onExit);
        resolve(match[1]);
      }
    };
    child!.stdout!.on('data', onData);
    child!.stderr!.on('data', onData);
    child!.once('error', error => { clearTimeout(timer); reject(error); });
  });
  return { address, logs: () => logs, sqlitePath };
}

test('domain admission leaves empty users intact and warns how to create the first admin', async () => {
  const server = await startServer('@example.test', false);
  const db = new Database(server.sqlitePath, { readonly: true });
  try {
    expect(db.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 0 });
    expect(server.logs()).toMatch(/full email address.*first admin/i);
  } finally { db.close(); }
});

test('a full email address still seeds the first admin', async () => {
  const server = await startServer('owner@example.test', false);
  const db = new Database(server.sqlitePath, { readonly: true });
  try {
    expect(db.prepare('SELECT email, role FROM users').all())
      .toEqual([{ email: 'owner@example.test', role: 'admin' }]);
  } finally { db.close(); }
});

test('bypass binds the actual server only to IPv4 loopback', async () => {
  const server = await startServer('', true);
  expect(new URL(server.address).hostname).toBe('127.0.0.1');
  expect((await fetch(server.address + '/api/auth/status')).status).toBe(200);
  const external = Object.values(networkInterfaces()).flat()
    .find(address => address?.family === 'IPv4' && !address.internal);
  expect(external).toBeDefined();
  const externallyReachable = await new Promise<boolean>(resolve => {
    const socket = createConnection({ host: external!.address, port: Number(new URL(server.address).port) });
    socket.setTimeout(1500);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
  expect(externallyReachable).toBe(false);
});
