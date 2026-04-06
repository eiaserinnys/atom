import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
  },
  webServer: [
    {
      command: 'pnpm run dev',
      port: 4200,
      reuseExistingServer: true,
      env: {
        API_PORT: '4200',
        JWT_SECRET: 'e2e-test-secret',
        NODE_ENV: 'test',
        // GOOGLE_CLIENT_ID and SLACK_CLIENT_ID intentionally unset → bypass mode
      },
    },
    {
      command: 'pnpm run dev',
      cwd: './dashboard',
      port: 5173,
      reuseExistingServer: true,
      env: {
        VITE_API_BASE_URL: 'http://localhost:4200',
      },
    },
  ],
});
