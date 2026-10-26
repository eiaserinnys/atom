import Fastify from 'fastify';
import { systemRoutes } from '../../src/api/routes/system.js';

test('health identifies one server boot consistently and changes on a new boot', async () => {
  async function start() {
    const app = Fastify();
    await app.register(systemRoutes);
    return app;
  }
  const first = await start();
  const second = await start();
  try {
    const health = (await first.inject('/api/health')).json();
    expect(health.status).toBe('ok');
    expect(health.bootId).toEqual(expect.any(String));
    expect(health.bootId.length).toBeGreaterThan(0);
    expect((await first.inject('/api/health')).json().bootId).toBe(health.bootId);
    expect((await second.inject('/api/health')).json().bootId).not.toBe(health.bootId);
  } finally {
    await first.close();
    await second.close();
  }
});
