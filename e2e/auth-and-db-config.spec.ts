import { test, expect } from '@playwright/test';
import { resetTestDb } from './helpers';

test.describe('Auth config and DB connection test', () => {
  test.beforeAll(() => {
    resetTestDb();
  });

  test('can configure OAuth settings in Auth tab', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=atom')).toBeVisible({ timeout: 15_000 });

    // Open settings
    await page.locator('button[aria-label="Settings"]').click();
    await expect(page.locator('text=Settings')).toBeVisible();

    // Click Auth tab (exact match to avoid "External Auth")
    await page.getByRole('button', { name: 'Auth', exact: true }).click();

    // Wait for Auth tab content to load
    await expect(page.locator('text=Google OAuth')).toBeVisible({ timeout: 5_000 });

    // Fill Google OAuth Client ID — target the input within the modal
    const modal = page.locator('.fixed.inset-0');
    const inputs = modal.locator('input[type="text"]');
    await inputs.first().fill('test-google-client-id');

    // Click Save button within the modal
    await modal.getByRole('button', { name: /Save/i }).click();

    // Success message or check that save completed
    await expect(modal.locator('text=Settings saved').or(modal.locator('text=설정이 저장되었습니다'))).toBeVisible({ timeout: 5_000 });
  });

  test('restart banner appears after saving auth settings', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=atom')).toBeVisible({ timeout: 15_000 });

    // Open settings → Auth → save
    await page.locator('button[aria-label="Settings"]').click();
    await page.getByRole('button', { name: 'Auth', exact: true }).click();
    await expect(page.locator('text=Google OAuth')).toBeVisible({ timeout: 5_000 });

    const modal = page.locator('.fixed.inset-0');
    await modal.locator('input[type="text"]').first().fill('trigger-restart');
    await modal.getByRole('button', { name: /Save/i }).click();

    // Wait for save to complete
    await expect(modal.locator('text=Settings saved').or(modal.locator('text=설정이 저장되었습니다'))).toBeVisible({ timeout: 5_000 });

    // Close config modal
    await modal.locator('button[aria-label="Close"]').click();

    // Restart banner should be visible (check both en/ko)
    await expect(page.locator('text=Restart Now').or(page.locator('text=지금 재시작'))).toBeVisible({ timeout: 10_000 });
  });

  test('DB connection test with invalid URL shows error', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=atom')).toBeVisible({ timeout: 15_000 });

    // Open settings → Database tab
    await page.locator('button[aria-label="Settings"]').click();
    await page.getByRole('button', { name: /Database/i }).click();

    const modal = page.locator('.fixed.inset-0');
    const connInput = modal.locator('input[placeholder*="postgresql"]');
    if (await connInput.isVisible()) {
      await connInput.fill('postgresql://invalid:invalid@127.0.0.1:9999/nonexistent');
      await modal.getByRole('button', { name: /Test Connection/i }).click();

      // Should show failure message
      await expect(modal.locator('text=Connection failed').or(modal.locator('text=연결 실패'))).toBeVisible({ timeout: 10_000 });
    }
  });
});
