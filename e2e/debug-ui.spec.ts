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

  // Check auth status directly
  const authRes = await page.request.get('http://127.0.0.1:14200/api/auth/status');
  console.log('Auth status:', await authRes.text());

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
