import { test, expect } from '@playwright/test';
import { resetTestDb, createTestCard, logRoots, logChildren, dragNodeToPosition } from './helpers.js';

test.describe('Tree DnD — 시나리오 1: 루트 노드 위치 이동', () => {
  let nodeA: string;
  let nodeB: string;
  let nodeX: string;

  test.beforeAll(async () => {
    await resetTestDb();

    // 루트에 A, B (structure), X (knowledge) 순서로 생성
    const a = await createTestCard({ card_type: 'structure', title: 'FolderA' });
    const b = await createTestCard({ card_type: 'structure', title: 'FolderB' });
    const x = await createTestCard({ card_type: 'knowledge', title: 'CardX' });
    nodeA = a.node_id;
    nodeB = b.node_id;
    nodeX = x.node_id;
    console.log(`[SETUP] A=${nodeA.slice(-6)} B=${nodeB.slice(-6)} X=${nodeX.slice(-6)}`);
    await logRoots('초기 DB 상태');
  });

  test('초기 상태: A, B, X 순서', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(`[data-testid="tree-node-${nodeA}"]`)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(`[data-testid="tree-node-${nodeB}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="tree-node-${nodeX}"]`)).toBeVisible();

    const roots = await logRoots('초기 상태 확인');
    const titles = roots.map(r => r.card.title);
    expect(titles).toEqual(['FolderA', 'FolderB', 'CardX']);
  });

  test('X를 A 앞(above A)으로 이동 → 순서: X, A, B', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(`[data-testid="tree-node-${nodeX}"]`)).toBeVisible({ timeout: 15_000 });

    await logRoots('드래그 전');
    await dragNodeToPosition(page, nodeX, nodeA, 'above');
    const roots = await logRoots('드래그 후 (X above A)');

    const titles = roots.map(r => r.card.title);
    console.log(`[ASSERT] expected=[CardX, FolderA, FolderB]  got=[${titles.join(', ')}]  pass=${JSON.stringify(titles) === JSON.stringify(['CardX', 'FolderA', 'FolderB'])}`);
    expect(titles).toEqual(['CardX', 'FolderA', 'FolderB']);
  });

  test('X를 A와 B 사이(below A)로 이동 → 순서: A, X, B', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(`[data-testid="tree-node-${nodeX}"]`)).toBeVisible({ timeout: 15_000 });

    await logRoots('드래그 전');
    await dragNodeToPosition(page, nodeX, nodeA, 'below');
    const roots = await logRoots('드래그 후 (X below A)');

    const titles = roots.map(r => r.card.title);
    console.log(`[ASSERT] expected=[FolderA, CardX, FolderB]  got=[${titles.join(', ')}]  pass=${JSON.stringify(titles) === JSON.stringify(['FolderA', 'CardX', 'FolderB'])}`);
    expect(titles).toEqual(['FolderA', 'CardX', 'FolderB']);
  });

  test('X를 B 뒤(below B)로 이동 → 순서: A, B, X', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(`[data-testid="tree-node-${nodeX}"]`)).toBeVisible({ timeout: 15_000 });

    await logRoots('드래그 전');
    await dragNodeToPosition(page, nodeX, nodeB, 'below');
    const roots = await logRoots('드래그 후 (X below B)');

    const titles = roots.map(r => r.card.title);
    console.log(`[ASSERT] expected=[FolderA, FolderB, CardX]  got=[${titles.join(', ')}]  pass=${JSON.stringify(titles) === JSON.stringify(['FolderA', 'FolderB', 'CardX'])}`);
    expect(titles).toEqual(['FolderA', 'FolderB', 'CardX']);
  });
});

test.describe('Tree DnD — 시나리오 2: 구조 카드 자식 위치 이동', () => {
  let nodeA: string;
  let nodeB: string;
  let nodeC: string;
  let nodeX: string;

  test.beforeAll(async () => {
    await resetTestDb();

    // A (structure root), B (A의 자식 knowledge), C (A의 자식 knowledge), X (root knowledge)
    const a = await createTestCard({ card_type: 'structure', title: 'FolderA' });
    const b = await createTestCard({ card_type: 'knowledge', title: 'CardB', parent_node_id: a.node_id });
    const c = await createTestCard({ card_type: 'knowledge', title: 'CardC', parent_node_id: a.node_id });
    const x = await createTestCard({ card_type: 'knowledge', title: 'CardX' });
    nodeA = a.node_id;
    nodeB = b.node_id;
    nodeC = c.node_id;
    nodeX = x.node_id;
    console.log(`[SETUP] A=${nodeA.slice(-6)} B=${nodeB.slice(-6)} C=${nodeC.slice(-6)} X=${nodeX.slice(-6)}`);
    await logRoots('초기 DB 상태');
    await logChildren('초기 A 자식', nodeA);
  });

  test('초기 상태: 루트=[A, X], A의 자식=[B, C]', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(`[data-testid="tree-node-${nodeA}"]`)).toBeVisible({ timeout: 15_000 });

    const roots = await logRoots('초기 루트 상태');
    expect(roots.map(r => r.card.title)).toContain('FolderA');
    expect(roots.map(r => r.card.title)).toContain('CardX');

    const children = await logChildren('초기 A 자식', nodeA);
    expect(children.map(c => c.card.title)).toEqual(['CardB', 'CardC']);
  });

  test('X를 A into(A의 자식)로 이동', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(`[data-testid="tree-node-${nodeX}"]`)).toBeVisible({ timeout: 15_000 });

    await logRoots('드래그 전 루트');
    await dragNodeToPosition(page, nodeX, nodeA, 'into');
    const children = await logChildren('드래그 후 A 자식 (X into A)', nodeA);

    const titles = children.map(c => c.card.title);
    console.log(`[ASSERT] X가 A의 자식에 있어야 함  got=[${titles.join(', ')}]  pass=${titles.includes('CardX')}`);
    expect(titles).toContain('CardX');
  });

  test('X를 B 앞(above B, A 안)으로 이동', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(`[data-testid="tree-node-${nodeA}"]`)).toBeVisible({ timeout: 15_000 });

    const bLocator = page.locator(`[data-testid="tree-node-${nodeB}"]`);
    const bVisible = await bLocator.isVisible();
    if (!bVisible) {
      const aEl = page.locator(`[data-testid="tree-node-${nodeA}"] > div`).first();
      await aEl.locator('span').first().click();
      await page.waitForTimeout(300);
    }

    await expect(bLocator).toBeVisible({ timeout: 5_000 });

    await logChildren('드래그 전 A 자식', nodeA);
    await dragNodeToPosition(page, nodeX, nodeB, 'above');
    const children = await logChildren('드래그 후 A 자식 (X above B)', nodeA);

    const titles = children.map(c => c.card.title);
    const xIdx = titles.indexOf('CardX');
    const bIdx = titles.indexOf('CardB');
    console.log(`[ASSERT] X(${xIdx}) < B(${bIdx})  got=[${titles.join(', ')}]  pass=${xIdx >= 0 && bIdx >= 0 && xIdx < bIdx}`);
    expect(xIdx).toBeGreaterThanOrEqual(0);
    expect(bIdx).toBeGreaterThanOrEqual(0);
    expect(xIdx).toBeLessThan(bIdx);
  });

  test('X를 B 뒤(below B, B와 C 사이)로 이동', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(`[data-testid="tree-node-${nodeA}"]`)).toBeVisible({ timeout: 15_000 });

    const bLocator = page.locator(`[data-testid="tree-node-${nodeB}"]`);
    const bVisible = await bLocator.isVisible();
    if (!bVisible) {
      const aEl = page.locator(`[data-testid="tree-node-${nodeA}"] > div`).first();
      await aEl.locator('span').first().click();
      await page.waitForTimeout(300);
    }

    await expect(bLocator).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(`[data-testid="tree-node-${nodeX}"]`)).toBeVisible({ timeout: 5_000 });

    await logChildren('드래그 전 A 자식', nodeA);
    await dragNodeToPosition(page, nodeX, nodeB, 'below');
    const children = await logChildren('드래그 후 A 자식 (X below B)', nodeA);

    const titles = children.map(c => c.card.title);
    const xIdx = titles.indexOf('CardX');
    const bIdx = titles.indexOf('CardB');
    const cIdx = titles.indexOf('CardC');
    console.log(`[ASSERT] B(${bIdx}) < X(${xIdx}) < C(${cIdx})  got=[${titles.join(', ')}]  pass=${xIdx > bIdx && xIdx < cIdx}`);
    expect(xIdx).toBeGreaterThan(bIdx);
    expect(xIdx).toBeLessThan(cIdx);
  });

  test('X를 C 뒤(below C)로 이동', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(`[data-testid="tree-node-${nodeA}"]`)).toBeVisible({ timeout: 15_000 });

    const cLocator = page.locator(`[data-testid="tree-node-${nodeC}"]`);
    const cVisible = await cLocator.isVisible();
    if (!cVisible) {
      const aEl = page.locator(`[data-testid="tree-node-${nodeA}"] > div`).first();
      await aEl.locator('span').first().click();
      await page.waitForTimeout(300);
    }

    await expect(cLocator).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(`[data-testid="tree-node-${nodeX}"]`)).toBeVisible({ timeout: 5_000 });

    await logChildren('드래그 전 A 자식', nodeA);
    await dragNodeToPosition(page, nodeX, nodeC, 'below');
    const children = await logChildren('드래그 후 A 자식 (X below C)', nodeA);

    const titles = children.map(c => c.card.title);
    const xIdx = titles.indexOf('CardX');
    const cIdx = titles.indexOf('CardC');
    console.log(`[ASSERT] C(${cIdx}) < X(${xIdx})  got=[${titles.join(', ')}]  pass=${xIdx > cIdx}`);
    expect(xIdx).toBeGreaterThan(cIdx);
  });
});
