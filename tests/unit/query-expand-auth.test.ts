import { jest } from '@jest/globals';
import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { SignJWT } from 'jose';

// Keep the real cookie/JWT/global middleware/route chain; replace only user storage.
jest.unstable_mockModule('../../src/db/client.js', () => ({ getDb: () => ({}) }));
jest.unstable_mockModule('../../src/db/queries/users.js', () => ({
  findUserById: async () => ({ id: 'viewer', email: 'viewer@example.test', role: 'viewer', is_active: true }),
}));
const { authMiddleware } = await import('../../src/api/middleware/auth.js');
const { createSearchExpandRoutes } = await import('../../src/api/routes/search-expand.js');

test('a JWT viewer reaches query expansion through the global authentication middleware', async () => {
  const saved = { ...process.env };
  process.env['GOOGLE_CLIENT_ID'] = 'test-provider';
  process.env['JWT_SECRET'] = 'query-expand-test-secret';
  const app = Fastify({ logger: false });
  try {
    await app.register(cookie);
    app.addHook('preHandler', authMiddleware);
    app.register(createSearchExpandRoutes({ expand: async () => ({ statusCode: 200, body: { status: 'ready', neighbors: [] } }) } as never));
    const token = await new SignJWT({ id: 'viewer' }).setProtectedHeader({ alg: 'HS256' })
      .sign(new TextEncoder().encode(process.env['JWT_SECRET']));
    const response = await app.inject({ method: 'POST', url: '/search/expand', headers: { cookie: `atom_auth=${token}` }, payload: { query: 'queue' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ready');
  } finally { await app.close(); process.env = saved; }
});
