import { test, expect } from '@playwright/test';

// The server for this spec runs on the env file that `npm run setup -- --password-stdin` wrote (playwright.config.ts).
const password = process.env.ATOM_E2E_FRESH_PASSWORD!;

test.use({ baseURL: 'http://127.0.0.1:14201' });

test.describe('Fresh install — password written by npm run setup', () => {
  test('shows the login form, rejects a wrong password, and the setup password reaches the first screen', async ({ page }) => {
    await page.goto('/');
    const input = page.getByTestId('password-login-input');
    await expect(input).toBeVisible({ timeout: 15_000 });

    await input.fill('not-the-setup-password');
    await page.getByTestId('password-login-button').click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.locator('button[aria-label="Settings"]')).toHaveCount(0);

    await input.fill(password);
    await page.getByTestId('password-login-button').click();
    await expect(page.locator('button[aria-label="Settings"]')).toBeVisible({ timeout: 15_000 });
  });

  test('can open Config and create an agent API key', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('password-login-input').fill(password);
    await page.getByTestId('password-login-button').click();
    await expect(page.locator('button[aria-label="Settings"]')).toBeVisible({ timeout: 15_000 });

    await page.locator('button[aria-label="Settings"]').click();

    const modal = page.locator('.fixed.inset-0');
    await expect(modal.getByText('Settings', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: /API Keys/i }).click();

    const agentInput = modal.getByLabel('Agent ID');
    await agentInput.fill('test-e2e-agent');

    await modal.getByRole('button', { name: /Generate/i }).click();

    await expect(modal.locator('text=API Secret')).toBeVisible({ timeout: 10_000 });

    const gotItBtn = modal.getByRole('button', { name: /Got it/i });
    if (await gotItBtn.isVisible()) {
      await gotItBtn.click();
    }

    await expect(modal.locator('text=test-e2e-agent')).toBeVisible();
  });
});
