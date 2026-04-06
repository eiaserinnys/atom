import { test, expect } from '@playwright/test';
import { resetTestDb } from './helpers';

test('debug: check bypass mode UI state', async ({ page }) => {
  resetTestDb();
  await page.goto('/');
  await expect(page.locator('text=atom')).toBeVisible({ timeout: 15_000 });

  // Wait a bit for auth to settle
  await page.waitForTimeout(2000);

  // Screenshot the full page
  await page.screenshot({ path: 'e2e/debug-screenshot.png', fullPage: true });

  // Check auth status by inspecting network
  const authResponse = await page.evaluate(async () => {
    const BASE_URL = (import.meta as Record<string, Record<string, string>>).env?.VITE_API_BASE_URL ?? '';
    const res = await fetch(`${BASE_URL}/api/auth/status`, { credentials: 'same-origin' });
    return res.json();
  });
  console.log('Auth status:', JSON.stringify(authResponse));

  // Check all buttons on page
  const buttons = await page.locator('button').all();
  const buttonTexts = [];
  for (const btn of buttons) {
    const text = await btn.textContent();
    const ariaLabel = await btn.getAttribute('aria-label');
    buttonTexts.push({ text: text?.trim(), ariaLabel });
  }
  console.log('Buttons found:', JSON.stringify(buttonTexts, null, 2));

  // Check if settings button exists with different selectors
  const byTitle = page.locator('button[title="Settings"]');
  const byAriaLabel = page.locator('button[aria-label="Settings"]');
  const byEmoji = page.locator('button:has-text("⚙")');
  console.log('By title:', await byTitle.count());
  console.log('By aria-label:', await byAriaLabel.count());
  console.log('By emoji:', await byEmoji.count());
});
