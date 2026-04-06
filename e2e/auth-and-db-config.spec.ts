import { test, expect } from '@playwright/test';
import { resetTestDb } from './helpers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env');

test.describe('Auth config and DB connection test', () => {
  test.beforeAll(() => {
    resetTestDb();
    if (fs.existsSync(envPath)) fs.unlinkSync(envPath);
  });

  test('save auth settings → success message → restart banner', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.text-xl.font-bold')).toBeVisible({ timeout: 15_000 });

    // Open settings
    await page.locator('button[aria-label="Settings"]').click();
    const modal = page.locator('.fixed.inset-0');
    await expect(modal.locator('.text-base.font-semibold')).toBeVisible();

    // Click Auth tab
    await page.getByRole('button', { name: 'Auth', exact: true }).click();
    await expect(modal.locator('text=Google OAuth')).toBeVisible({ timeout: 5_000 });

    // Fill Google Client ID
    await modal.locator('input[type="text"]').first().fill('test-google-client-id');

    // Save
    await modal.getByRole('button', { name: /Save/i }).click();
    await expect(modal.locator('text=Settings saved').or(modal.locator('text=설정이 저장되었습니다'))).toBeVisible({ timeout: 5_000 });

    // Close modal
    await modal.locator('button[aria-label="Close"]').click();

    // Restart banner should appear (refreshStatus is called after save)
    await expect(page.locator('text=Restart Now').or(page.locator('text=지금 재시작'))).toBeVisible({ timeout: 5_000 });
  });

  test('DB connection test with invalid URL shows error', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.text-xl.font-bold')).toBeVisible({ timeout: 15_000 });

    await page.locator('button[aria-label="Settings"]').click();
    const modal = page.locator('.fixed.inset-0');
    await page.getByRole('button', { name: /Database/i }).click();

    const connInput = modal.locator('input[placeholder*="postgresql"]');
    if (await connInput.isVisible()) {
      await connInput.fill('postgresql://invalid:invalid@127.0.0.1:9999/nonexistent');
      await modal.getByRole('button', { name: /Test Connection/i }).click();
      await expect(modal.locator('text=Connection failed').or(modal.locator('text=연결 실패'))).toBeVisible({ timeout: 15_000 });
    }
  });
});
