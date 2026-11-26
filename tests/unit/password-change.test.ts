import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import { parse } from 'dotenv';
import Fastify, { type FastifyInstance } from 'fastify';
import { authMiddleware } from '../../src/api/middleware/auth.js';
import { authRoutes } from '../../src/api/routes/auth.js';
import { cardApiRoutes } from '../../src/api/routes/card_api.js';
import { cardRoutes } from '../../src/api/routes/cards.js';
import { createPasswordLoginRoutes } from '../../src/api/routes/password_login.js';
import { treeRoutes } from '../../src/api/routes/tree.js';
import { SqliteAdapter } from '../../src/db/adapters/sqlite.js';
import { runMigrations, setDb } from '../../src/db/client.js';
import { findUserByEmail, updateUserRole } from '../../src/db/queries/users.js';

const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/db/migrations-sqlite');
const OLD = 'old-password-1';
const NEW = 'new-password-2';
const ENV_FILE_TEXT = '# keep this comment\nJWT_SECRET=file-secret\nDASHBOARD_ADMIN_PASSWORD=old-password-1\n\nOTHER=value # note\n';
const originalEnv = { ...process.env };
let db: SqliteAdapter;
let app: FastifyInstance;
let dir: string;
let envFile: string;
let logs = '';

async function makeApp(): Promise<FastifyInstance> {
  const stream = new Writable({ write(chunk, _enc, done) { logs += chunk; done(); } });
  const server = Fastify({ logger: { level: 'trace', stream } });
  server.register(cookie);
  server.register(authRoutes);
  server.register(createPasswordLoginRoutes());
  server.addHook('preHandler', authMiddleware);
  server.register(cardRoutes);
  server.register(treeRoutes);
  server.register(cardApiRoutes);
  await server.ready();
  return server;
}

async function login(password: string, remoteAddress = '192.0.2.10') {
  return app.inject({ method: 'POST', url: '/api/auth/password-login', remoteAddress, payload: { password } });
}

async function sessionCookie(password = OLD): Promise<string> {
  const response = await login(password);
  expect(response.statusCode).toBe(200);
  return (response.headers['set-cookie'] as string).split(';')[0];
}

function change(headers: Record<string, string> | undefined, payload: unknown, remoteAddress = '192.0.2.10') {
  return app.inject({ method: 'POST', url: '/api/auth/password', headers, remoteAddress, payload: payload as object });
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atom-password-change-'));
  envFile = path.join(dir, 'custom.env');
  fs.writeFileSync(envFile, ENV_FILE_TEXT);
  process.env = {
    ...originalEnv, JWT_SECRET: 'password-change-test-secret', FRONTEND_URL: 'http://localhost:5173',
    ATOM_ENV_FILE: envFile, DASHBOARD_ADMIN_PASSWORD: OLD,
  };
  for (const key of ['GOOGLE_CLIENT_ID', 'SLACK_CLIENT_ID', 'AUTH_BYPASS']) delete process.env[key];
  db = new SqliteAdapter(':memory:');
  setDb(db);
  await runMigrations(migrations);
  logs = '';
  app = await makeApp();
});
afterEach(async () => {
  await app.close();
  await db.close();
  process.env = { ...originalEnv };
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('POST /api/auth/password gates', () => {
  it.each([
    ['oauth', { GOOGLE_CLIENT_ID: 'google' }],
    ['bypass', { DASHBOARD_ADMIN_PASSWORD: '', AUTH_BYPASS: '1' }],
    ['unconfigured', { DASHBOARD_ADMIN_PASSWORD: '' }],
  ])('is 404 in %s mode', async (_mode, env) => {
    Object.assign(process.env, env);
    const response = await change(undefined, { current_password: OLD, new_password: NEW });
    expect(response.statusCode).toBe(404);
    expect(fs.readFileSync(envFile, 'utf8')).toBe(ENV_FILE_TEXT);
  });

  it('is 401 without a session and 403 for a non-admin session', async () => {
    const anonymous = await change(undefined, { current_password: OLD, new_password: NEW });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toMatchObject({ code: 'SESSION_INVALID' });
    const headers = { cookie: await sessionCookie() };
    await updateUserRole(db, (await findUserByEmail(db, 'owner@local'))!.id, 'editor');
    expect((await change(headers, { current_password: OLD, new_password: NEW })).statusCode).toBe(403);
    expect(fs.readFileSync(envFile, 'utf8')).toBe(ENV_FILE_TEXT);
  });

  it('is 401 for a wrong current password and shares the login failure limit', async () => {
    const headers = { cookie: await sessionCookie() };
    for (let i = 0; i < 5; i++) expect((await login('wrong')).statusCode).toBe(401);
    for (let i = 0; i < 5; i++) {
      const response = await change(headers, { current_password: 'wrong', new_password: NEW });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ code: 'INVALID_CURRENT_PASSWORD' });
    }
    const blocked = await change(headers, { current_password: OLD, new_password: NEW });
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect((await login(OLD)).statusCode).toBe(429);
    expect(fs.readFileSync(envFile, 'utf8')).toBe(ENV_FILE_TEXT);
  });

  it.each([
    ['too short', 'short12'],
    ['too long', 'x'.repeat(257)],
    ['whitespace only', ' '.repeat(10)],
    ['edge whitespace', ' leading-space-1'],
    ['line break', 'line-one\nline-two'],
    ['unstorable quoting', 'a#\'b"c`d-1234'],
    ['not a string', 12345678],
  ])('is 400 INVALID_INPUT for a %s password', async (_name, value) => {
    const headers = { cookie: await sessionCookie() };
    const response = await change(headers, { current_password: OLD, new_password: value });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: expect.any(String), code: 'INVALID_INPUT' });
    expect(fs.readFileSync(envFile, 'utf8')).toBe(ENV_FILE_TEXT);
    expect((await login(OLD)).statusCode).toBe(200);
  });

  it('accepts exactly 8 and 256 characters', async () => {
    const headers = { cookie: await sessionCookie() };
    expect((await change(headers, { current_password: OLD, new_password: 'x'.repeat(256) })).statusCode).toBe(200);
    const next = { cookie: (await login('x'.repeat(256))).headers['set-cookie'] as string };
    expect((await change({ cookie: next.cookie.split(';')[0] }, { current_password: 'x'.repeat(256), new_password: '12345678' })).statusCode).toBe(200);
  });
});

describe('a session cut off by another change', () => {
  it('answers 401 SESSION_INVALID, which differs from a wrong current password', async () => {
    const stale = { cookie: await sessionCookie() };
    const other = { cookie: await sessionCookie() };
    expect((await change(other, { current_password: OLD, new_password: NEW })).statusCode).toBe(200);
    const response = await change(stale, { current_password: NEW, new_password: 'third-password-3' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'SESSION_INVALID' });
    expect(parse(fs.readFileSync(envFile, 'utf8'))['DASHBOARD_ADMIN_PASSWORD']).toBe(NEW);
  });
});

describe('the same password as now', () => {
  it('is 400 SAME_PASSWORD, writes nothing and keeps other sessions', async () => {
    const headers = { cookie: await sessionCookie() };
    const other = { cookie: await sessionCookie() };
    const response = await change(headers, { current_password: OLD, new_password: OLD });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: expect.any(String), code: 'SAME_PASSWORD' });
    expect(fs.readFileSync(envFile, 'utf8')).toBe(ENV_FILE_TEXT);
    expect((await app.inject({ url: '/tree', headers: other })).statusCode).toBe(200);
  });

  it('does not reveal the password to someone who gave a wrong current password', async () => {
    const headers = { cookie: await sessionCookie() };
    const response = await change(headers, { current_password: 'wrong-password', new_password: OLD });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'INVALID_CURRENT_PASSWORD' });
  });
});

describe('the env file round trip', () => {
  const FILE_WITH_QUOTES = [
    '# comments stay', 'JWT_SECRET=file-secret', 'DASHBOARD_ADMIN_PASSWORD=old-password-1',
    "SINGLE=ends with a quote'", 'DOUBLE=ends with a quote"', 'BACKTICK=ends with a quote`', 'KEEP=plain value', '',
  ].join('\n');

  it.each([
    ["starting with a single quote", "'abcdefgh"],
    ['starting with a double quote', '"abcdefgh'],
    ['starting with a backtick', '`abcdefgh'],
    ['with a dollar sign', 'pa$word-$1234'],
    ['with a backslash', 'pa\\ss\\nword-1'],
    ['with a hash', 'pass#word-1234'],
    ['with inner spaces', 'pass word with spaces'],
  ])('reads back the whole file unchanged except the password: %s', async (_name, password) => {
    fs.writeFileSync(envFile, FILE_WITH_QUOTES);
    const before = parse(FILE_WITH_QUOTES);
    const headers = { cookie: await sessionCookie() };
    const response = await change(headers, { current_password: OLD, new_password: password });
    expect(response.statusCode).toBe(200);
    expect(parse(fs.readFileSync(envFile, 'utf8'))).toEqual({ ...before, DASHBOARD_ADMIN_PASSWORD: password });
    expect((await login(password)).statusCode).toBe(200);
  });

  it('refuses with 400 and leaves the file alone when the password mixes all three quote kinds', async () => {
    const text = FILE_WITH_QUOTES;
    fs.writeFileSync(envFile, text);
    const headers = { cookie: await sessionCookie() };
    const response = await change(headers, { current_password: OLD, new_password: 'a#\'b"c`d-1234' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'INVALID_INPUT' });
    expect(fs.readFileSync(envFile, 'utf8')).toBe(text);
  });
});

describe('a successful change', () => {
  it('rewrites only the password line of the env file and takes effect without a restart', async () => {
    const oldCookie = await sessionCookie();
    const response = await change({ cookie: oldCookie }, { current_password: OLD, new_password: NEW });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(fs.readFileSync(envFile, 'utf8')).toBe(ENV_FILE_TEXT.replace(`=${OLD}`, `=${NEW}`));
    expect(process.env['DASHBOARD_ADMIN_PASSWORD']).toBe(NEW);

    expect((await login(OLD)).statusCode).toBe(401);
    const fresh = await login(NEW);
    expect(fresh.statusCode).toBe(200);

    expect((await app.inject({ url: '/tree', headers: { cookie: oldCookie } })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/auth/status', headers: { cookie: oldCookie } })).json()).toEqual({ authenticated: false });
    const newCookie = (response.headers['set-cookie'] as string).split(';')[0];
    expect((await app.inject({ url: '/tree', headers: { cookie: newCookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/auth/status', headers: { cookie: newCookie } })).json()).toMatchObject({ authenticated: true, role: 'admin' });
    expect(response.headers['set-cookie']).toEqual(expect.stringMatching(/HttpOnly/i));
  });

  it('adds the line when the file has none and creates a missing file', async () => {
    fs.writeFileSync(envFile, '# only a comment\nOTHER=1');
    const headers = { cookie: await sessionCookie() };
    expect((await change(headers, { current_password: OLD, new_password: NEW })).statusCode).toBe(200);
    expect(fs.readFileSync(envFile, 'utf8')).toBe(`# only a comment\nOTHER=1\nDASHBOARD_ADMIN_PASSWORD=${NEW}`);
    fs.rmSync(envFile);
    const after = { cookie: (await login(NEW)).headers['set-cookie'] as string };
    expect((await change({ cookie: after.cookie.split(';')[0] }, { current_password: NEW, new_password: 'third-password-3' })).statusCode).toBe(200);
    expect(parse(fs.readFileSync(envFile, 'utf8'))).toEqual({ DASHBOARD_ADMIN_PASSWORD: 'third-password-3' });
  });

  it('stores symbols so the loader reads back exactly the same password', async () => {
    const headers = { cookie: await sessionCookie() };
    const symbols = 'p#ss w"rd\'1';
    expect((await change(headers, { current_password: OLD, new_password: symbols })).statusCode).toBe(200);
    expect(parse(fs.readFileSync(envFile, 'utf8'))['DASHBOARD_ADMIN_PASSWORD']).toBe(symbols);
    expect(parse(fs.readFileSync(envFile, 'utf8'))['OTHER']).toBe('value');
    expect((await login(symbols)).statusCode).toBe(200);
  });

  it('never puts a password in a response or a log line', async () => {
    const headers = { cookie: await sessionCookie() };
    const ok = await change(headers, { current_password: OLD, new_password: NEW });
    const bad = await change({ cookie: (ok.headers['set-cookie'] as string).split(';')[0] }, { current_password: 'wrong-password', new_password: 'another-password' });
    for (const text of [ok.body, bad.body, logs]) {
      for (const secret of [OLD, NEW, 'wrong-password', 'another-password']) expect(text).not.toContain(secret);
    }
  });
});

describe('when the env file cannot be written', () => {
  it('answers 500, changes nothing and keeps the old password working', async () => {
    fs.rmSync(envFile);
    fs.mkdirSync(envFile);
    const headers = { cookie: await sessionCookie() };
    const response = await change(headers, { current_password: OLD, new_password: NEW });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: expect.any(String), code: 'ENV_FILE_WRITE_FAILED' });
    expect(process.env['DASHBOARD_ADMIN_PASSWORD']).toBe(OLD);
    expect((await login(OLD)).statusCode).toBe(200);
    expect((await login(NEW)).statusCode).toBe(401);
    expect((await app.inject({ url: '/tree', headers })).statusCode).toBe(200);
  });
});

describe('MCP OAuth tokens follow the password session', () => {
  const redirectUri = 'http://127.0.0.1:8765/callback';
  const verifier = 'v'.repeat(48);

  async function oauthClient(): Promise<string> {
    const registered = await app.inject({ method: 'POST', url: '/api/auth/oauth/register', payload: { redirect_uris: [redirectUri] } });
    return registered.json().client_id;
  }

  async function authorize(clientId: string, headers: Record<string, string>): Promise<string> {
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const query = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, state: 's', response_type: 'code',
      code_challenge: challenge, code_challenge_method: 'S256',
    });
    const response = await app.inject({ url: `/api/auth/oauth/authorize?${query}`, headers });
    const location = String(response.headers.location ?? '');
    return new URL(location, redirectUri).searchParams.get('code') ?? '';
  }

  function exchange(clientId: string, code: string) {
    return app.inject({
      method: 'POST', url: '/api/auth/oauth/token',
      payload: { grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: redirectUri, code_verifier: verifier },
    });
  }

  it('revokes issued access tokens, refresh tokens and unused codes when the password changes', async () => {
    const headers = { cookie: await sessionCookie() };
    const clientId = await oauthClient();
    const issued = (await exchange(clientId, await authorize(clientId, headers))).json();
    const pendingCode = await authorize(clientId, headers);
    expect(pendingCode).not.toBe('');
    const bearer = { authorization: `Bearer ${issued.access_token}` };
    expect((await app.inject({ url: '/api/tree/outline', headers: bearer })).statusCode).toBe(200);

    expect((await change(headers, { current_password: OLD, new_password: NEW })).statusCode).toBe(200);

    expect((await app.inject({ url: '/api/tree/outline', headers: bearer })).statusCode).toBe(401);
    const refreshed = await app.inject({
      method: 'POST', url: '/api/auth/oauth/token',
      payload: { grant_type: 'refresh_token', client_id: clientId, refresh_token: issued.refresh_token },
    });
    expect(refreshed.statusCode).toBe(400);
    expect((await exchange(clientId, pendingCode)).statusCode).toBe(400);
    expect(await authorize(clientId, headers)).toBe('');
  });

  it('keeps tokens issued after the change working and refreshable', async () => {
    const headers = { cookie: await sessionCookie() };
    const clientId = await oauthClient();
    expect((await change(headers, { current_password: OLD, new_password: NEW })).statusCode).toBe(200);
    const cookieAfter = { cookie: (await login(NEW)).headers['set-cookie'] as string };
    const issued = (await exchange(clientId, await authorize(clientId, { cookie: cookieAfter.cookie.split(';')[0] }))).json();
    expect((await app.inject({ url: '/api/tree/outline', headers: { authorization: `Bearer ${issued.access_token}` } })).statusCode).toBe(200);
    const refreshed = await app.inject({
      method: 'POST', url: '/api/auth/oauth/token',
      payload: { grant_type: 'refresh_token', client_id: clientId, refresh_token: issued.refresh_token },
    });
    expect(refreshed.statusCode).toBe(200);
    expect((await app.inject({ url: '/api/tree/outline', headers: { authorization: `Bearer ${refreshed.json().access_token}` } })).statusCode).toBe(200);
  });
});
