import { test, expect } from '@playwright/test';
import { resetTestDb } from './helpers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env');

test.describe('Fresh install — bypass mode API key issuance', () => {
  test.beforeAll(async () => {
    await resetTestDb();
    // Ensure clean .env (no pendingRestart state from other tests)
    if (fs.existsSync(envPath)) fs.unlinkSync(envPath);
  });

  test('can access dashboard without login in bypass mode', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('button[aria-label="Settings"]')).toBeVisible({ timeout: 15_000 });
  });

  test('can open Config and create an agent API key', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('button[aria-label="Settings"]')).toBeVisible({ timeout: 15_000 });

    await page.locator('button[aria-label="Settings"]').click();

    // Wait for modal header specifically
    const modal = page.locator('.fixed.inset-0');
    await expect(modal.locator('.text-base.font-semibold')).toBeVisible();

    await page.getByRole('button', { name: /API Keys/i }).click();

    const agentInput = modal.locator('input[placeholder*="agent_id"]');
    await agentInput.fill('test-e2e-agent');

    await modal.getByRole('button', { name: /Generate/i }).click();

    // API secret should appear
    await expect(modal.locator('text=API Secret')).toBeVisible({ timeout: 10_000 });

    const gotItBtn = modal.getByRole('button', { name: /Got it/i });
    if (await gotItBtn.isVisible()) {
      await gotItBtn.click();
    }

    await expect(modal.locator('text=test-e2e-agent')).toBeVisible();
  });
});
