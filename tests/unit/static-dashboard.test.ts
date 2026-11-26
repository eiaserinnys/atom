import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { authMiddleware } from '../../src/api/middleware/auth.js';
import { authRoutes } from '../../src/api/routes/auth.js';
import { createPasswordLoginRoutes } from '../../src/api/routes/password_login.js';
import { cardRoutes } from '../../src/api/routes/cards.js';
import { treeRoutes } from '../../src/api/routes/tree.js';
import { configRoutes } from '../../src/api/routes/config.js';
import { createDashboardStaticRoutes, isReservedBackendPath } from '../../src/api/static-dashboard.js';
import { SqliteAdapter } from '../../src/db/adapters/sqlite.js';
import { runMigrations, setDb } from '../../src/db/client.js';

const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/db/migrations-sqlite');
const originalEnv = { ...process.env };
let db: SqliteAdapter;
let dir: string;
let app: FastifyInstance;

async function makeApp(staticDir?: string): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });
  server.register(cookie);
  server.register(authRoutes);
  server.register(createPasswordLoginRoutes());
  server.addHook('preHandler', authMiddleware);
  server.register(cardRoutes);
  server.register(treeRoutes);
  server.register(configRoutes);
  if (staticDir) server.register(createDashboardStaticRoutes(staticDir));
  await server.ready();
  return server;
}

beforeEach(async () => {
  process.env = { ...originalEnv, JWT_SECRET: 'static-dashboard-test-secret', DASHBOARD_ADMIN_PASSWORD: 'password' };
  for (const key of ['GOOGLE_CLIENT_ID', 'SLACK_CLIENT_ID', 'AUTH_BYPASS']) delete process.env[key];
  db = new SqliteAdapter(':memory:');
  setDb(db);
  await runMigrations(migrations);
  dir = await mkdtemp(path.join(os.tmpdir(), 'atom-static-'));
  await mkdir(path.join(dir, 'assets'));
  await writeFile(path.join(dir, 'index.html'), '<html>dashboard marker</html>');
  await writeFile(path.join(dir, 'assets/app.js'), 'console.log("asset")');
});
afterEach(async () => {
  if (app) await app.close();
  await db.close();
  await rm(dir, { recursive: true, force: true });
  process.env = { ...originalEnv };
});

it('serves only static routes publicly and keeps registered data routes protected', async () => {
  app = await makeApp(dir);
  const root = await app.inject('/');
  expect(root.statusCode).toBe(200);
  expect(root.headers['content-type']).toContain('text/html');
  expect(root.headers['cache-control']).toBe('no-cache');
  expect(root.body).toContain('dashboard marker');
  expect((await app.inject({ method: 'HEAD', url: '/' })).statusCode).toBe(200);
  const asset = await app.inject('/assets/app.js');
  expect(asset.statusCode).toBe(200);
  expect(asset.headers['content-type']).toContain('javascript');
  expect((await app.inject('/some/client/route')).body).toContain('dashboard marker');
  const missing = await app.inject('/assets/missing.js');
  expect(missing.statusCode).toBe(404);
  expect(missing.json()).toEqual({ error: 'Not Found' });
  for (const url of ['/api/nonexistent', '/.well-known/nonexistent']) {
    const response = await app.inject(url);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Not Found' });
  }
  const backlink = '/backlinks/00000000-0000-4000-8000-000000000001';
  expect((await app.inject(backlink)).statusCode).toBe(401);
  expect((await app.inject('/tree')).statusCode).toBe(401);
  const traversal = await app.inject('/%2e%2e/package.json');
  expect([400, 404]).toContain(traversal.statusCode);
  expect(traversal.body).not.toContain('"name": "atom"');
  expect((await app.inject('/%E0%A4%A')).statusCode).toBe(400);
  const login = await app.inject({ method: 'POST', url: '/api/auth/password-login', payload: { password: 'password' } });
  const headers = { cookie: (login.headers['set-cookie'] as string).split(';')[0] };
  const links = await app.inject({ url: backlink, headers });
  expect(links.statusCode).toBe(404);
  expect(links.json()).toEqual({ error: 'Card not found: 00000000-0000-4000-8000-000000000001' });
  expect((await app.inject({ url: '/tree', headers })).statusCode).toBe(200);
});

it('does not serve the dashboard without a configured directory', async () => {
  app = await makeApp();
  const response = await app.inject('/');
  expect(response.statusCode === 200 && response.headers['content-type']?.includes('text/html')).toBeFalsy();
});

it('rejects a directory without an index file at registration', async () => {
  await rm(path.join(dir, 'index.html'));
  const server = Fastify();
  server.register(createDashboardStaticRoutes(dir));
  await expect(server.ready()).rejects.toThrow(/DASHBOARD_DIR.*index\.html/);
  await server.close();
});

it.each([
  ['/api', true], ['/api/x', true], ['/mcp', true], ['/mcp/x', true],
  ['/.well-known/x', true], ['/register', true], ['/apix', false], ['/registerx', false], ['/', false],
])('classifies reserved path %s', (value, expected) => {
  expect(isReservedBackendPath(value)).toBe(expected);
});
