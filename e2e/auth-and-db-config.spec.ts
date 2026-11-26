import { test, expect } from '@playwright/test';
import { resetTestDb } from './helpers';
import fs from 'fs';
import path from 'path';
const envPath = path.join(process.env.ATOM_E2E_DIR!, '.env');

test.describe('Auth config and DB connection test', () => {
  test.beforeAll(async () => {
    await resetTestDb();
    if (fs.existsSync(envPath)) fs.unlinkSync(envPath);
  });

  test.afterAll(() => {
    if (fs.existsSync(envPath)) fs.unlinkSync(envPath);
  });

  test('a save the server could not start with is refused: reason shown, no restart notice, env file untouched', async ({ page }) => {
    // The e2e server runs with AUTH_BYPASS=1 from its shell. This file blanks it and holds the only login method,
    // the way a real settings file would: emptying the Google ID leaves no way to sign in.
    const before = [
      'AUTH_BYPASS=',
      'GOOGLE_CLIENT_ID=e2e-google-id',
      'GOOGLE_CLIENT_SECRET=e2e-google-secret',
      'GOOGLE_CALLBACK_URL=http://127.0.0.1:14200/api/auth/google/callback',
      '',
    ].join('\n');
    fs.writeFileSync(envPath, before, 'utf8');
    try {
      await page.goto('/');
      await expect(page.locator('button[aria-label="Settings"]')).toBeVisible({ timeout: 15_000 });
      await page.locator('button[aria-label="Settings"]').click();
      const modal = page.locator('.fixed.inset-0');
      await page.getByRole('button', { name: 'Auth', exact: true }).click();
      const googleClientId = modal.getByLabel(/^(Client ID|클라이언트 ID)$/).first();
      await expect(googleClientId).toHaveValue('e2e-google-id', { timeout: 5_000 });

      await googleClientId.fill('');
      await modal.getByRole('button', { name: /^(Save|저장)$/ }).click();

      await expect(modal.getByText(/Not saved\. The server would not start again with these settings\.|저장하지 않았습니다\. 이 설정으로는 서버가 다시 뜨지 않습니다\./)).toBeVisible({ timeout: 5_000 });
      await expect(modal.getByText(/Every login method has been removed\.|로그인 방법이 하나도 남지 않습니다\./)).toBeVisible();
      await expect(modal.getByText('No login method is configured, so the server will not start.')).toHaveCount(0);
      await expect(modal.getByText(/[{}]|API \d{3}/)).toHaveCount(0);
      await expect(modal.getByRole('button', { name: /Stop Server|Restart Now|서버 끄기|지금 재시작/ })).toHaveCount(0);

      await modal.locator('button[aria-label="Close"]').click();
      await expect(page.getByText(/Stop the server and start it again yourself|서버를 끈 뒤 직접 다시 띄워야/)).toHaveCount(0);
      expect(fs.readFileSync(envPath, 'utf8')).toBe(before);
    } finally {
      fs.unlinkSync(envPath);
    }
  });

  test('save auth settings → success message → manual restart notice with a Stop Server button', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('button[aria-label="Settings"]')).toBeVisible({ timeout: 15_000 });

    // Open settings
    await page.locator('button[aria-label="Settings"]').click();
    const modal = page.locator('.fixed.inset-0');
    await expect(modal.getByText('Settings', { exact: true })).toBeVisible();

    // Click Auth tab
    await page.getByRole('button', { name: 'Auth', exact: true }).click();
    await expect(modal.locator('text=Google OAuth')).toBeVisible({ timeout: 5_000 });

    // Fill a setting the e2e server (bypass mode) can start with
    await modal.getByLabel(/^(Initial Admin Email|첫 어드민 이메일)$/).fill('admin@example.test');

    // Save
    await modal.getByRole('button', { name: /^(Save|저장)$/ }).click();

    // The e2e server runs under tsx, so it cannot restart itself: the notice says to stop it and the button is Stop Server.
    const manualNotice = /Settings changed\. Stop the server and start it again yourself to apply\.|설정이 변경되었습니다\. 서버를 끈 뒤 직접 다시 띄워야 적용됩니다\./;
    const stopServer = /^(Stop Server|서버 끄기)$/;
    await expect(modal.getByText(manualNotice)).toBeVisible({ timeout: 5_000 });
    await expect(modal.getByRole('button', { name: stopServer })).toBeVisible();
    // Only the field that was edited is written; the untouched login fields are not sent as empty values.
    expect(fs.readFileSync(envPath, 'utf8').trim()).toBe('ALLOWED_EMAIL=admin@example.test');

    // Close modal; the banner shows the same notice and button. Nothing here presses the button.
    await modal.locator('button[aria-label="Close"]').click();
    await expect(page.getByText(manualNotice)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: stopServer })).toBeVisible();
  });

  test('DB connection test with invalid URL shows error', async ({ page }) => {
    await page.route('**/api/system/status', route => route.fulfill({ json: { pendingRestart: false } }));

    await page.goto('/');
    await expect(page.locator('button[aria-label="Settings"]')).toBeVisible({ timeout: 15_000 });

    await page.locator('button[aria-label="Settings"]').click();
    const modal = page.locator('.fixed.inset-0');
    await page.getByRole('button', { name: /Database/i }).click();

    const connInput = modal.getByLabel('PostgreSQL Connection String');
    await connInput.fill('postgresql://invalid:invalid@127.0.0.1:9999/nonexistent');
    await modal.getByRole('button', { name: /Test Connection/i }).click();
    await expect(modal.locator('text=Connection failed').or(modal.locator('text=연결 실패'))).toBeVisible({ timeout: 15_000 });
  });
});
