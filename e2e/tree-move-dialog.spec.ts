import { test, expect } from '@playwright/test';
import { resetTestDb, createTestCard, getNodeChildren } from './helpers.js';

test.describe('MoveCardModal — 시나리오 3: 깊은 depth structure 노드로 이동', () => {
  let nodeR: string;
  let nodeC: string;
  let nodeG: string;
  let nodeX: string;

  test.beforeAll(async () => {
    await resetTestDb();

    // R (root structure) → C (R의 자식 structure) → G (C의 자식 structure)
    // X (root knowledge) — G로 이동 대상
    const r = await createTestCard({ card_type: 'structure', title: 'Root' });
    const c = await createTestCard({ card_type: 'structure', title: 'Child', parent_node_id: r.node_id });
    const g = await createTestCard({ card_type: 'structure', title: 'Grandchild', parent_node_id: c.node_id });
    const x = await createTestCard({ card_type: 'knowledge', title: 'CardX' });
    nodeR = r.node_id;
    nodeC = c.node_id;
    nodeG = g.node_id;
    nodeX = x.node_id;
  });

  test('MoveCardModal에서 2depth structure(Grandchild)가 표시되고 선택 가능', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(`[data-testid="tree-node-${nodeX}"]`)).toBeVisible({ timeout: 15_000 });

    // X를 우클릭하여 컨텍스트 메뉴 열기
    const xEl = page.locator(`[data-testid="tree-node-${nodeX}"] > div`).first();
    await xEl.click({ button: 'right' });

    // 컨텍스트 메뉴 대기
    await expect(page.locator('[data-testid="context-menu"]')).toBeVisible({ timeout: 5_000 });

    // "Move Card" 메뉴 클릭 (영어 기준)
    const moveButton = page.locator('[data-testid="context-menu-item"]').filter({ hasText: /Move/i }).first();
    await expect(moveButton).toBeVisible({ timeout: 3_000 });
    await moveButton.click();

    // MoveCardModal 열림 확인
    const modal = page.locator('.fixed.inset-0');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // 2depth structure 노드 'Grandchild'가 보여야 함 (fetchFullStructureTree 수정의 핵심 검증)
    await expect(modal.locator('button').filter({ hasText: 'Grandchild' })).toBeVisible({ timeout: 8_000 });

    // Grandchild 선택
    await modal.locator('button').filter({ hasText: 'Grandchild' }).click();

    // 확인 버튼 클릭 (move_modal.confirm_btn: "Move")
    const confirmBtn = modal.locator('button').filter({ hasText: /^Move$/i });
    await expect(confirmBtn).toBeEnabled({ timeout: 3_000 });
    await confirmBtn.click();

    // 모달이 닫혀야 함
    await expect(modal).not.toBeVisible({ timeout: 8_000 });

    // API로 X가 G(Grandchild)의 자식이 됐는지 확인
    const gChildren = await getNodeChildren(nodeG);
    const titles = gChildren.map(c => c.card.title);
    expect(titles).toContain('CardX');
  });
});
