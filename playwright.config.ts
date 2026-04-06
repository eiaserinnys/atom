import { defineConfig } from '@playwright/test';

// Use non-production ports to avoid interfering with any running services.
// Use 127.0.0.1 explicitly — Fastify binds to 0.0.0.0 (IPv4),
// and "localhost" may resolve to ::1 (IPv6) on some systems.
const TEST_API_PORT = '14200';
const TEST_API_HOST = '127.0.0.1';
const TEST_FRONTEND_PORT = 15173;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: `http://${TEST_API_HOST}:${TEST_FRONTEND_PORT}`,
    headless: true,
  },
  webServer: [
    {
      command: 'pnpm run dev',
      url: `http://${TEST_API_HOST}:${TEST_API_PORT}/api/health`,
      reuseExistingServer: false,
      env: {
        API_PORT: TEST_API_PORT,
        JWT_SECRET: 'e2e-test-secret',
        NODE_ENV: 'test',
        // GOOGLE_CLIENT_ID and SLACK_CLIENT_ID intentionally unset → bypass mode
      },
    },
    {
      command: `pnpm run dev -- --port ${TEST_FRONTEND_PORT} --host ${TEST_API_HOST}`,
      cwd: './dashboard',
      url: `http://${TEST_API_HOST}:${TEST_FRONTEND_PORT}`,
      reuseExistingServer: false,
      env: {
        VITE_API_BASE_URL: `http://${TEST_API_HOST}:${TEST_API_PORT}`,
      },
    },
  ],
});
