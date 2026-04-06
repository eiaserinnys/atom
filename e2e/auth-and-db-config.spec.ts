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
    const settingsBtn = page.locator('button[aria-label]').filter({ hasText: '⚙️' });
    await settingsBtn.click();
    await expect(page.locator('text=Settings')).toBeVisible();

    // Click Auth tab
    await page.getByRole('button', { name: /Auth/i }).click();

    // Fill Google OAuth Client ID (test value)
    const clientIdInput = page.locator('input').first();
    await clientIdInput.fill('test-google-client-id');

    // Fill ALLOWED_EMAIL
    const emailInputs = page.locator('input[type="text"]');
    const lastInput = emailInputs.last();
    await lastInput.fill('admin@test.com');

    // Click Save
    await page.getByRole('button', { name: /Save/i }).click();

    // Success message
    await expect(page.locator('text=Settings saved')).toBeVisible({ timeout: 5_000 });
  });

  test('restart banner appears after saving auth settings', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=atom')).toBeVisible({ timeout: 15_000 });

    // Open settings → Auth → save something
    const settingsBtn = page.locator('button[aria-label]').filter({ hasText: '⚙️' });
    await settingsBtn.click();
    await page.getByRole('button', { name: /Auth/i }).click();

    const clientIdInput = page.locator('input').first();
    await clientIdInput.fill('trigger-restart-banner');
    await page.getByRole('button', { name: /Save/i }).click();

    // Close config modal
    await page.locator('button[aria-label="Close"]').click();

    // Restart banner should be visible
    await expect(page.locator('text=Restart Now')).toBeVisible({ timeout: 10_000 });
  });

  test('DB connection test with invalid URL shows error', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=atom')).toBeVisible({ timeout: 15_000 });

    // Open settings → Database tab
    const settingsBtn = page.locator('button[aria-label]').filter({ hasText: '⚙️' });
    await settingsBtn.click();
    await page.getByRole('button', { name: /Database/i }).click();

    // If in SQLite mode, connection string input should be visible
    const connInput = page.locator('input[placeholder*="postgresql"]');
    if (await connInput.isVisible()) {
      await connInput.fill('postgresql://invalid:invalid@localhost:9999/nonexistent');
      await page.getByRole('button', { name: /Test Connection/i }).click();

      // Should show failure message
      await expect(page.locator('text=Connection failed')).toBeVisible({ timeout: 10_000 });
    }
  });
});
