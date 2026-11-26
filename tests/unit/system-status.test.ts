import Fastify from 'fastify';
import { systemRoutes } from '../../src/api/routes/system.js';
import { setPendingRestart } from '../../src/api/state.js';

afterEach(() => setPendingRestart(false));

async function statusAs(role: 'admin' | 'editor' | null) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => {
    if (role) req.jwtUser = { id: 'u1', email: 'u1@example.test', name: 'U1', role };
  });
  await app.register(systemRoutes);
  try {
    return await app.inject('/api/system/status');
  } finally {
    await app.close();
  }
}

test('status tells an admin whether a restart is pending and whether it stays down until started by hand', async () => {
  setPendingRestart(true);

  const response = await statusAs('admin');

  expect(response.statusCode).toBe(200);
  // Jest runs plain node, like the compiled production server: a restart is not a manual start.
  expect(response.json()).toEqual({ pendingRestart: true, manualRestartRequired: false });
});

test('status stays admin only', async () => {
  expect((await statusAs('editor')).statusCode).toBe(403);
  expect((await statusAs(null)).statusCode).toBe(401);
});
