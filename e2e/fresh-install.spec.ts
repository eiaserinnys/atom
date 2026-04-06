import { test, expect } from '@playwright/test';
import { resetTestDb } from './helpers';

test.describe('Fresh install — bypass mode API key issuance', () => {
  test.beforeAll(() => {
    resetTestDb();
  });

  test('can access dashboard without login in bypass mode', async ({ page }) => {
    await page.goto('/');
    // In bypass mode, should skip login and show the main app
    await expect(page.locator('text=atom')).toBeVisible({ timeout: 15_000 });
  });

  test('can open Config and create an agent API key', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=atom')).toBeVisible({ timeout: 15_000 });

    // Click settings button
    await page.locator('button[aria-label="Settings"]').click();

    // Config modal should be visible
    await expect(page.locator('text=Settings')).toBeVisible();

    // Click API Keys tab
    await page.getByRole('button', { name: /API Keys/i }).click();

    // Fill in agent_id
    const agentInput = page.locator('input[placeholder*="agent_id"]');
    await agentInput.fill('test-e2e-agent');

    // Click Generate
    await page.getByRole('button', { name: /Generate/i }).click();

    // API secret should appear (shown only once)
    await expect(page.locator('text=API Secret')).toBeVisible({ timeout: 10_000 });

    // Acknowledge
    const gotItBtn = page.getByRole('button', { name: /Got it/i });
    if (await gotItBtn.isVisible()) {
      await gotItBtn.click();
    }

    // Agent should appear in the list
    await expect(page.locator('text=test-e2e-agent')).toBeVisible();
  });
});
