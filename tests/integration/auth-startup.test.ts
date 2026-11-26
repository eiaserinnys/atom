import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { createConnection } from 'node:net';
import path from 'node:path';
import Database from 'better-sqlite3';

// Exercise the real startup path in a foreground-owned child with a fresh env and DB.
// Other route integration tests use Fastify directly and cannot cover listen/seed.
let child: ChildProcess | undefined;
let directory: string;
let sourceDirectory: string;

beforeAll(() => {
  sourceDirectory = mkdtempSync(path.join(realpathSync(tmpdir()), 'atom-auth-startup-source-'));
  cpSync(path.resolve('src'), path.join(sourceDirectory, 'src'), { recursive: true });
  symlinkSync(path.resolve('node_modules'), path.join(sourceDirectory, 'node_modules'), 'junction');
  writeFileSync(path.join(sourceDirectory, 'package.json'), '{"type":"module"}');
  writeFileSync(path.join(sourceDirectory, '.env'), '');
  cpSync(path.resolve('.env.example'), path.join(sourceDirectory, '.env.example'));
});
afterAll(() => { rmSync(sourceDirectory, { recursive: true, force: true }); });
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

function spawnServer(extraEnv: Record<string, string>) {
  const sqlitePath = path.join(directory, 'startup-test.db');
  child = spawn(process.execPath, ['--import', 'tsx', 'src/api/index.ts'], {
    cwd: sourceDirectory,
    env: {
      PATH: process.env['PATH'], NODE_ENV: 'test', API_PORT: '0',
      SQLITE_PATH: sqlitePath, ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return sqlitePath;
}

async function startServer(allowedEmail: string, bypass: boolean, extraEnv: Record<string, string> = {}) {
  const sqlitePath = spawnServer({
    ALLOWED_EMAIL: allowedEmail,
    ...(bypass ? { AUTH_BYPASS: '1' } : {}),
    ...extraEnv,
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
  const server = await startServer('@example.test', true);
  const db = new Database(server.sqlitePath, { readonly: true });
  try {
    expect(db.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 0 });
    expect(server.logs()).toMatch(/full email address.*first admin/i);
  } finally { db.close(); }
});

test('a full email address still seeds the first admin', async () => {
  const server = await startServer('owner@example.test', true);
  const db = new Database(server.sqlitePath, { readonly: true });
  try {
    expect(db.prepare('SELECT email, role FROM users').all())
      .toEqual([{ email: 'owner@example.test', role: 'admin' }]);
  } finally { db.close(); }
});

test('the example ALLOWED_EMAIL creates nobody, and a real address on the next start becomes the admin', async () => {
  const first = await startServer('your-email@gmail.com', true);
  expect(first.logs()).toMatch(/example value/i);
  let db = new Database(first.sqlitePath, { readonly: true });
  try {
    expect(db.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 0 });
  } finally { db.close(); }
  const exited = once(child!, 'exit');
  child!.kill('SIGTERM');
  await exited;

  const second = await startServer('me@example.test', true);
  db = new Database(second.sqlitePath, { readonly: true });
  try {
    expect(db.prepare('SELECT email, role FROM users').all())
      .toEqual([{ email: 'me@example.test', role: 'admin' }]);
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

test('with no login method the server exits with a notice naming the env file and creates no database', async () => {
  const sqlitePath = spawnServer({});
  let logs = '';
  child!.stdout!.on('data', (chunk: Buffer) => { logs += chunk.toString(); });
  child!.stderr!.on('data', (chunk: Buffer) => { logs += chunk.toString(); });
  const [code] = await once(child!, 'exit');

  expect(code).toBe(1);
  expect(logs).toContain('npm run setup');
  expect(logs).toContain('DASHBOARD_ADMIN_PASSWORD');
  expect(logs).toContain('AUTH_BYPASS=1');
  expect(logs).toContain(path.join(sourceDirectory, '.env'));
  expect(existsSync(sqlitePath)).toBe(false);
});

test('a password-mode server starts with the file setup wrote, and that password logs in', async () => {
  const envFile = path.join(directory, 'setup-written.env');
  writeFileSync(envFile, 'API_PORT=0\nNODE_ENV=test\n');
  const password = 'setup-written-password-1';
  const setup = spawn(process.execPath, ['--import', 'tsx', 'src/setup/main.ts', '--password-stdin'], {
    cwd: sourceDirectory,
    env: { PATH: process.env['PATH'], ATOM_ENV_FILE: envFile },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let setupOutput = '';
  setup.stdout!.on('data', (chunk: Buffer) => { setupOutput += chunk.toString(); });
  setup.stderr!.on('data', (chunk: Buffer) => { setupOutput += chunk.toString(); });
  setup.stdin!.end(password + '\n');
  const [setupCode] = await once(setup, 'exit');
  expect(setupCode).toBe(0);
  expect(setupOutput).not.toContain(password);
  expect(setupOutput).not.toContain(/^JWT_SECRET=(.*)$/m.exec(readFileSync(envFile, 'utf8'))![1]);

  const server = await startServer('', false, { ATOM_ENV_FILE: envFile });
  const providers = await (await fetch(server.address + '/api/auth/providers')).json();
  expect(providers).toEqual({ google: false, slack: false, password: true });
  const login = (candidate: string) => fetch(server.address + '/api/auth/password-login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: candidate }),
  });
  expect((await login('not-the-password-1')).status).toBe(401);
  const accepted = await login(password);
  expect(accepted.status).toBe(200);
  const cookie = accepted.headers.getSetCookie()[0]!.split(';')[0]!;
  expect(await (await fetch(server.address + '/api/auth/status', { headers: { cookie } })).json())
    .toMatchObject({ authenticated: true, role: 'admin' });
});

test('an OAuth-mode server starts as before and offers only its provider', async () => {
  const server = await startServer('', false, {
    GOOGLE_CLIENT_ID: 'oauth-test-client', GOOGLE_CLIENT_SECRET: 'oauth-test-secret',
    GOOGLE_CALLBACK_URL: 'https://atom.example.test/api/auth/google/callback',
    FRONTEND_URL: 'https://atom.example.test', JWT_SECRET: 'oauth-test-jwt-secret',
  });
  expect(await (await fetch(server.address + '/api/auth/providers')).json()).toEqual({ google: true, slack: false });
  expect(await (await fetch(server.address + '/api/auth/status')).json()).toEqual({ authenticated: false });
  expect((await fetch(server.address + '/api/auth/password-login', { method: 'POST' })).status).toBe(404);
});
