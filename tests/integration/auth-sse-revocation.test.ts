import { jest } from '@jest/globals';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import http, { type IncomingMessage } from 'node:http';
import { once } from 'node:events';
import { SignJWT } from 'jose';
import { authMiddleware } from '../../src/api/middleware/auth.js';
import { authRoutes } from '../../src/api/routes/auth.js';
import { configRoutes } from '../../src/api/routes/config.js';
import { eventsRoutes } from '../../src/api/routes/events.js';
import { insertUser, updateUserActive, updateUserRole, type User } from '../../src/db/queries/users.js';
import { createCard } from '../../src/services/card.service.js';
import { eventBus } from '../../src/events/eventBus.js';
import { getIntegrationTestPool, setupIntegrationTestDb } from './integration-harness.js';

setupIntegrationTestDb();
const savedEnv = { ...process.env };
const secret = 'card678-p3-isolated-secret';
let app: FastifyInstance;
let port: number;
const streams: IncomingMessage[] = [];

beforeEach(async () => {
  process.env['JWT_SECRET'] = secret;
  process.env['GOOGLE_CLIENT_ID'] = 'test-provider';
  delete process.env['SLACK_CLIENT_ID'];
  delete process.env['AUTH_BYPASS'];
  app = Fastify({ logger: false });
  await app.register(cookie);
  app.addHook('preHandler', authMiddleware);
  await app.register(authRoutes);
  await app.register(configRoutes);
  await app.register(eventsRoutes);
  await app.listen({ host: '127.0.0.1', port: 0 });
  port = (app.server.address() as { port: number }).port;
});

afterEach(async () => {
  jest.restoreAllMocks();
  streams.splice(0).forEach(stream => stream.destroy());
  await app.close();
  process.env = { ...savedEnv };
});

async function user(role: User['role'] = 'viewer') {
  return insertUser(getIntegrationTestPool(), { email: `${crypto.randomUUID()}@example.test`, role });
}

async function cookieFor(user: User, expiration = Math.floor(Date.now() / 1000) + 3600) {
  const token = await new SignJWT({ id: user.id, email: user.email, name: 'Old Name', role: user.role })
    .setProtectedHeader({ alg: 'HS256' }).setExpirationTime(expiration)
    .sign(new TextEncoder().encode(secret));
  return `atom_auth=${token}`;
}

async function openStream(cookieHeader?: string) {
  const request = http.get(`http://127.0.0.1:${port}/events`, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
  const [response] = await once(request, 'response') as [IncomingMessage];
  expect(response.statusCode).toBe(200);
  streams.push(response);
  let body = '';
  response.setEncoding('utf8');
  response.on('data', chunk => { body += chunk; });
  return { response, body: () => body };
}

async function expectClosed(response: IncomingMessage) {
  if (response.destroyed) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('SSE did not close'));
      response.destroy();
    }, 2000);
    response.once('close', () => { clearTimeout(timer); resolve(); });
  });
}

test.each([{ is_active: false }, { role: 'viewer' }])(
  'config change %j immediately closes every stream for that user', async change => {
    const admin = await user('admin');
    const target = await user('editor');
    const targetCookie = await cookieFor(target);
    const first = await openStream(targetCookie);
    const second = await openStream(targetCookie);
    const result = await app.inject({ method: 'PATCH', url: `/api/config/users/${target.id}`,
      headers: { cookie: await cookieFor(admin) }, payload: change });
    expect(result.statusCode).toBe(200);
    await Promise.all([expectClosed(first.response), expectClosed(second.response)]);
    await createCard({ title: 'Private after revocation', card_type: 'knowledge', content: 'SECRET-MARKER' });
    expect(first.body() + second.body()).toBe('');
  },
);

test('checks database deactivation immediately before sending a card event', async () => {
  const target = await user();
  const stream = await openStream(await cookieFor(target));
  await updateUserActive(getIntegrationTestPool(), target.id, false);
  await createCard({ title: 'Private', card_type: 'knowledge', content: 'SECRET-MARKER' });
  await expectClosed(stream.response);
  expect(stream.body()).toBe('');
});

test('checks token expiration at event time on an already open stream', async () => {
  const target = await user();
  const expiration = Math.floor(Date.now() / 1000) + 60;
  const stream = await openStream(await cookieFor(target, expiration));
  jest.spyOn(Date, 'now').mockReturnValue((expiration + 1) * 1000);
  await createCard({ title: 'Private', card_type: 'knowledge', content: 'EXPIRED-MARKER' });
  await expectClosed(stream.response);
  expect(stream.body()).toBe('');
});

test.each(['viewer', 'editor', 'admin'] as const)('active %s receives card events', async role => {
  const stream = await openStream(await cookieFor(await user(role)));
  const received = once(stream.response, 'data');
  const { card } = await createCard({ title: 'Visible', card_type: 'knowledge' });
  await received;
  expect(stream.body()).toContain(card.id);
  expect(stream.body()).toContain('card:created');
});

test('bypass streams keep receiving events without user storage', async () => {
  delete process.env['GOOGLE_CLIENT_ID'];
  process.env['AUTH_BYPASS'] = '1';
  const stream = await openStream();
  const received = once(stream.response, 'data');
  const { card } = await createCard({ title: 'Bypass', card_type: 'knowledge' });
  await received;
  expect(stream.body()).toContain(card.id);
});

test('auth/status returns the current database role', async () => {
  const target = await user('editor');
  const headers = { cookie: await cookieFor(target) };
  await updateUserRole(getIntegrationTestPool(), target.id, 'viewer');
  const status = await app.inject({ method: 'GET', url: '/api/auth/status', headers });
  expect(status.json()).toMatchObject({ authenticated: true, id: target.id, role: 'viewer' });
});

test('auth/status rejects inactive or deleted users', async () => {
  const target = await user();
  const headers = { cookie: await cookieFor(target) };
  await updateUserActive(getIntegrationTestPool(), target.id, false);
  expect((await app.inject({ method: 'GET', url: '/api/auth/status', headers })).json())
    .toEqual({ authenticated: false });
  await getIntegrationTestPool().query('DELETE FROM users WHERE id = $1', [target.id]);
  expect((await app.inject({ method: 'GET', url: '/api/auth/status', headers })).json())
    .toEqual({ authenticated: false });
});

test('removes event listeners when clients disconnect', async () => {
  const baseline = eventBus.listenerCount('atom:event');
  const stream = await openStream(await cookieFor(await user()));
  expect(eventBus.listenerCount('atom:event')).toBe(baseline + 1);
  stream.response.destroy();
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(eventBus.listenerCount('atom:event')).toBe(baseline);
});
