import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { jwtVerify } from 'jose';
import { getDashboardAdminPassword, resolveAuthMode } from '../../src/api/auth-mode.js';
import { inspectStartupConfig } from '../../src/api/startup-config.js';

const source = { envFile: '/tmp/atom-test.env', envFileFound: true };
import { authMiddleware } from '../../src/api/middleware/auth.js';
import { authRoutes } from '../../src/api/routes/auth.js';
import { createPasswordLoginRoutes } from '../../src/api/routes/password_login.js';
import { JWT_EXPIRY_SECONDS } from '../../src/api/routes/auth_helpers.js';
import { cardRoutes } from '../../src/api/routes/cards.js';
import { treeRoutes } from '../../src/api/routes/tree.js';
import { configRoutes } from '../../src/api/routes/config.js';
import { SqliteAdapter } from '../../src/db/adapters/sqlite.js';
import { runMigrations, setDb } from '../../src/db/client.js';
import { ensurePasswordAdminUser, findUserByEmail, insertUser, updateUserActive } from '../../src/db/queries/users.js';

const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/db/migrations-sqlite');
const secret = 'password-auth-test-secret';
const originalEnv = { ...process.env };
let db: SqliteAdapter;
let app: FastifyInstance;

async function makeApp(): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });
  server.register(cookie);
  server.register(authRoutes);
  server.register(createPasswordLoginRoutes());
  server.addHook('preHandler', authMiddleware);
  server.register(cardRoutes);
  server.register(treeRoutes);
  server.register(configRoutes);
  await server.ready();
  return server;
}

beforeEach(async () => {
  process.env = { ...originalEnv, JWT_SECRET: secret, FRONTEND_URL: 'http://localhost:5173' };
  for (const key of ['GOOGLE_CLIENT_ID', 'SLACK_CLIENT_ID', 'DASHBOARD_ADMIN_PASSWORD', 'AUTH_BYPASS']) delete process.env[key];
  db = new SqliteAdapter(':memory:');
  setDb(db);
  await runMigrations(migrations);
});
afterEach(async () => {
  if (app) await app.close();
  await db.close();
  process.env = { ...originalEnv };
});

describe('authentication mode and startup configuration', () => {
  it('resolves three modes, whitespace and OAuth precedence, and none for an empty setup', () => {
    expect(resolveAuthMode({})).toBeUndefined();
    expect(resolveAuthMode({ AUTH_BYPASS: '1' })).toBe('bypass');
    expect(resolveAuthMode({ DASHBOARD_ADMIN_PASSWORD: ' pass ' })).toBe('password');
    expect(getDashboardAdminPassword({ DASHBOARD_ADMIN_PASSWORD: ' pass ' })).toBe('pass');
    expect(resolveAuthMode({ DASHBOARD_ADMIN_PASSWORD: '   ' })).toBeUndefined();
    expect(resolveAuthMode({ GOOGLE_CLIENT_ID: ' ', DASHBOARD_ADMIN_PASSWORD: 'pass' })).toBe('oauth');
  });
  it('preserves an existing owner without changing its role, name or active state', async () => {
    const existing = await insertUser(db, { email: 'owner@local', display_name: 'Existing', role: 'viewer' });
    await updateUserActive(db, existing.id, false);
    const owner = await ensurePasswordAdminUser(db);
    expect(owner).toMatchObject({ id: existing.id, display_name: 'Existing', role: 'viewer', is_active: false });
  });
  it('validates password configuration and warns when OAuth wins', () => {
    expect(inspectStartupConfig({ DASHBOARD_ADMIN_PASSWORD: 'x', AUTH_BYPASS: '1', JWT_SECRET: secret }, source).errors)
      .toContain('AUTH_BYPASS=1 cannot be combined with DASHBOARD_ADMIN_PASSWORD.');
    expect(inspectStartupConfig({ DASHBOARD_ADMIN_PASSWORD: 'x', JWT_SECRET: ' ' }, source).errors)
      .toContain('Missing required environment variables: JWT_SECRET');
    expect(inspectStartupConfig({ DASHBOARD_ADMIN_PASSWORD: 'x', JWT_SECRET: secret }, source))
      .toEqual({ errors: [], warning: undefined });
    const env = { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_CALLBACK_URL: 'http://localhost/cb', FRONTEND_URL: 'http://localhost', JWT_SECRET: secret, DASHBOARD_ADMIN_PASSWORD: 'x' };
    expect(inspectStartupConfig(env, source).warning).toBe('DASHBOARD_ADMIN_PASSWORD is ignored because an OAuth provider is configured.');
  });
});

describe('OAuth provider combinations remain unchanged', () => {
  it.each([
    [true, false, false], [true, false, true],
    [false, true, false], [false, true, true],
    [true, true, false], [true, true, true],
  ])('Google=%s Slack=%s password=%s', async (google, slack, password) => {
    if (google) process.env['GOOGLE_CLIENT_ID'] = 'google-client';
    if (slack) process.env['SLACK_CLIENT_ID'] = 'slack-client';
    if (password) process.env['DASHBOARD_ADMIN_PASSWORD'] = 'password';
    process.env['GOOGLE_CALLBACK_URL'] = 'http://localhost/google/callback';
    process.env['SLACK_CALLBACK_URL'] = 'http://localhost/slack/callback';
    app = await makeApp();
    expect(resolveAuthMode()).toBe('oauth');
    const providers = (await app.inject('/api/auth/providers')).json();
    expect(Object.keys(providers)).toEqual(['google', 'slack']);
    expect(providers).toEqual({ google, slack });
    const login = await app.inject({ method: 'POST', url: '/api/auth/password-login', payload: { password: 'password' } });
    expect(login.statusCode).toBe(404);
    expect(login.headers['set-cookie']).toBeUndefined();
    expect(await findUserByEmail(db, 'owner@local')).toBeNull();
    for (const [enabled, provider, host] of [[google, 'google', 'https://accounts.google.com/'], [slack, 'slack', 'https://slack.com/']] as const) {
      if (!enabled) continue;
      const response = await app.inject(`/api/auth/${provider}`);
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toMatch(new RegExp(`^${host}`));
      expect(response.headers['set-cookie']).toEqual(expect.stringContaining('atom_oauth_state='));
    }
    expect((await app.inject('/tree')).statusCode).toBe(401);
  });
});

describe('password authentication', () => {
  beforeEach(async () => {
    process.env['DASHBOARD_ADMIN_PASSWORD'] = ' password ';
    app = await makeApp();
  });
  it('issues a session for the active owner and authorizes browser APIs', async () => {
    expect((await app.inject('/api/auth/status')).json()).toEqual({ authenticated: false });
    expect((await app.inject('/tree')).statusCode).toBe(401);
    expect((await app.inject('/api/auth/providers')).json()).toEqual({ google: false, slack: false, password: true });
    const bad = await app.inject({ method: 'POST', url: '/api/auth/password-login', payload: { password: 'wrong' } });
    expect(bad.statusCode).toBe(401);
    expect(bad.headers['set-cookie']).toBeUndefined();
    expect((await app.inject({ method: 'POST', url: '/api/auth/password-login', payload: { password: ' password ' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/password-login', payload: { password: 4 } })).statusCode).toBe(400);
    const login = await app.inject({ method: 'POST', url: '/api/auth/password-login', payload: { password: 'password' } });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toEqual({ ok: true });
    const cookieHeader = login.headers['set-cookie'] as string;
    expect(cookieHeader).not.toMatch(/; Secure/i);
    const token = cookieHeader.split(';')[0].split('=')[1];
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    expect(payload.typ).toBe('access');
    expect(payload.exp! - payload.iat!).toBe(JWT_EXPIRY_SECONDS);
    const headers = { cookie: cookieHeader.split(';')[0] };
    expect((await app.inject({ url: '/api/auth/status', headers })).json()).toMatchObject({ authenticated: true, email: 'owner@local', role: 'admin' });
    expect((await app.inject({ url: '/tree', headers })).statusCode).toBe(200);
    const agent = await app.inject({ method: 'POST', url: '/api/config/agents', headers, payload: { agent_id: 'soulstream', display_name: 'Soulstream', scope: 'write' } });
    expect(agent.statusCode).toBe(201);
    expect(typeof agent.json().secret).toBe('string');
    const secure = await app.inject({ method: 'POST', url: '/api/auth/password-login', headers: { 'x-forwarded-proto': 'HTTPS, http' }, payload: { password: 'password' } });
    expect(secure.statusCode).toBe(200);
    expect(secure.headers['set-cookie']).toEqual(expect.stringMatching(/; Secure/i));
    expect((await db.query("SELECT * FROM users WHERE email = 'owner@local'")).rows).toHaveLength(1);
    const owner = await findUserByEmail(db, 'owner@local');
    await updateUserActive(db, owner!.id, false);
    const disabled = await app.inject({ method: 'POST', url: '/api/auth/password-login', payload: { password: 'password' } });
    expect(disabled.statusCode).toBe(403);
    expect(disabled.json()).toEqual({ error: 'Account disabled' });
    expect(disabled.headers['set-cookie']).toBeUndefined();
  });
  it('limits failures by IP and blocks even a correct eleventh attempt', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await app.inject({ method: 'POST', url: '/api/auth/password-login', remoteAddress: '192.0.2.1', payload: { password: 'wrong' } })).statusCode).toBe(401);
    }
    const blocked = await app.inject({ method: 'POST', url: '/api/auth/password-login', remoteAddress: '192.0.2.1', payload: { password: 'password' } });
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect((await app.inject({ method: 'POST', url: '/api/auth/password-login', remoteAddress: '192.0.2.2', payload: { password: 'password' } })).statusCode).toBe(200);
  });
});
