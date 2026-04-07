import { test, expect } from '@playwright/test';
import { resetTestDb, createTestCard, getTreeRoots } from './helpers.js';

test.describe('Tree Delete — 시나리오 4: 카드 삭제', () => {
  let nodeX: string;

  test.beforeAll(async () => {
    await resetTestDb();
    const x = await createTestCard({ card_type: 'knowledge', title: 'DeleteMe' });
    nodeX = x.node_id;
  });

  test('우클릭 → Delete로 카드를 삭제하면 트리에서 사라진다', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(`[data-testid="tree-node-${nodeX}"]`)).toBeVisible({ timeout: 15_000 });

    // 우클릭 → 컨텍스트 메뉴 열기
    const xEl = page.locator(`[data-testid="tree-node-${nodeX}"] > div`).first();
    await xEl.click({ button: 'right' });

    // context-menu가 나타날 때까지 대기
    await expect(page.locator('[data-testid="context-menu"]')).toBeVisible({ timeout: 5_000 });

    // Delete 메뉴 클릭 (영어 기준: "Delete", 위험 버튼)
    const deleteButton = page.locator('[data-testid="context-menu-item"]').filter({ hasText: /Delete/i });
    await expect(deleteButton).toBeVisible({ timeout: 3_000 });
    await deleteButton.click();

    // 삭제 확인 모달
    const modal = page.locator('.fixed.inset-0');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // 확인 버튼 클릭 (DeleteConfirmModal의 confirm_btn: "Delete")
    const confirmBtn = modal.locator('button').filter({ hasText: /^Delete$/i });
    await expect(confirmBtn).toBeVisible({ timeout: 3_000 });
    await confirmBtn.click();

    // 모달이 닫혀야 함
    await expect(modal).not.toBeVisible({ timeout: 5_000 });

    // 트리에서 노드가 사라져야 함
    await expect(page.locator(`[data-testid="tree-node-${nodeX}"]`)).not.toBeVisible({ timeout: 5_000 });

    // API로도 확인: 루트에 X 없음
    const roots = await getTreeRoots();
    const ids = roots.map(r => r.id);
    expect(ids).not.toContain(nodeX);
  });

  test('삭제 후 다시 로드해도 노드가 없다 (DELETE 400 회귀 테스트)', async ({ page }) => {
    // 새 노드 생성 후 삭제 → 페이지 새로고침으로 확인
    const y = await createTestCard({ card_type: 'knowledge', title: 'DeleteMe2' });
    const nodeY = y.node_id;

    await page.goto('/');
    await expect(page.locator(`[data-testid="tree-node-${nodeY}"]`)).toBeVisible({ timeout: 15_000 });

    // 우클릭 → Delete
    const yEl = page.locator(`[data-testid="tree-node-${nodeY}"] > div`).first();
    await yEl.click({ button: 'right' });

    await expect(page.locator('[data-testid="context-menu"]')).toBeVisible({ timeout: 5_000 });
    const deleteButton = page.locator('[data-testid="context-menu-item"]').filter({ hasText: /^Delete$/i });
    await deleteButton.click();

    const modal = page.locator('.fixed.inset-0');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    const confirmBtn = modal.locator('button').filter({ hasText: /^Delete$/i });
    await confirmBtn.click();

    await expect(modal).not.toBeVisible({ timeout: 5_000 });

    // 페이지 새로고침 후에도 없어야 함 (DELETE API 400 회귀 방지)
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator(`[data-testid="tree-node-${nodeY}"]`)).not.toBeVisible({ timeout: 10_000 });
  });
});
