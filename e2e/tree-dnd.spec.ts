import { test, expect } from '@playwright/test';
import { resetTestDb, createTestCard, getTreeRoots, getNodeChildren, dragNodeToPosition } from './helpers.js';

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
  });

  test('초기 상태: A, B, X 순서', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(`[data-testid="tree-node-${nodeA}"]`)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(`[data-testid="tree-node-${nodeB}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="tree-node-${nodeX}"]`)).toBeVisible();

    const roots = await getTreeRoots();
    const titles = roots.map(r => r.card.title);
    expect(titles).toEqual(['FolderA', 'FolderB', 'CardX']);
  });

  test('X를 A 앞(above A)으로 이동 → 순서: X, A, B', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(`[data-testid="tree-node-${nodeX}"]`)).toBeVisible({ timeout: 15_000 });

    await dragNodeToPosition(page, nodeX, nodeA, 'above');

    const roots = await getTreeRoots();
    const titles = roots.map(r => r.card.title);
    expect(titles).toEqual(['CardX', 'FolderA', 'FolderB']);
  });

  test('X를 A와 B 사이(below A)로 이동 → 순서: A, X, B', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(`[data-testid="tree-node-${nodeX}"]`)).toBeVisible({ timeout: 15_000 });

    await dragNodeToPosition(page, nodeX, nodeA, 'below');

    const roots = await getTreeRoots();
    const titles = roots.map(r => r.card.title);
    expect(titles).toEqual(['FolderA', 'CardX', 'FolderB']);
  });

  test('X를 B 뒤(below B)로 이동 → 순서: A, B, X', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(`[data-testid="tree-node-${nodeX}"]`)).toBeVisible({ timeout: 15_000 });

    await dragNodeToPosition(page, nodeX, nodeB, 'below');

    const roots = await getTreeRoots();
    const titles = roots.map(r => r.card.title);
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
  });

  test('초기 상태: 루트=[A, X], A의 자식=[B, C]', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(`[data-testid="tree-node-${nodeA}"]`)).toBeVisible({ timeout: 15_000 });

    const roots = await getTreeRoots();
    expect(roots.map(r => r.card.title)).toContain('FolderA');
    expect(roots.map(r => r.card.title)).toContain('CardX');

    const children = await getNodeChildren(nodeA);
    expect(children.map(c => c.card.title)).toEqual(['CardB', 'CardC']);
  });

  test('X를 A into(A의 자식)로 이동', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(`[data-testid="tree-node-${nodeX}"]`)).toBeVisible({ timeout: 15_000 });

    await dragNodeToPosition(page, nodeX, nodeA, 'into');

    const children = await getNodeChildren(nodeA);
    const titles = children.map(c => c.card.title);
    expect(titles).toContain('CardX');
  });

  test('X를 B 앞(above B, A 안)으로 이동', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(`[data-testid="tree-node-${nodeA}"]`)).toBeVisible({ timeout: 15_000 });

    // 페이지 로드 시 A(루트 structure)는 자동 펼쳐진다.
    // toggle 클릭은 이미 열린 경우 닫아버리므로, B가 안 보일 때만 클릭한다.
    const bLocator = page.locator(`[data-testid="tree-node-${nodeB}"]`);
    const bVisible = await bLocator.isVisible();
    if (!bVisible) {
      const aEl = page.locator(`[data-testid="tree-node-${nodeA}"] > div`).first();
      await aEl.locator('span').first().click();
      await page.waitForTimeout(300);
    }

    await expect(bLocator).toBeVisible({ timeout: 5_000 });

    await dragNodeToPosition(page, nodeX, nodeB, 'above');

    const children = await getNodeChildren(nodeA);
    const titles = children.map(c => c.card.title);
    // X가 B 앞에 위치해야 함
    const xIdx = titles.indexOf('CardX');
    const bIdx = titles.indexOf('CardB');
    expect(xIdx).toBeGreaterThanOrEqual(0);
    expect(bIdx).toBeGreaterThanOrEqual(0);
    expect(xIdx).toBeLessThan(bIdx);
  });

  test('X를 B 뒤(below B, B와 C 사이)로 이동', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(`[data-testid="tree-node-${nodeA}"]`)).toBeVisible({ timeout: 15_000 });

    // A는 자동 펼쳐짐 — B가 안 보일 때만 toggle
    const bLocator = page.locator(`[data-testid="tree-node-${nodeB}"]`);
    const bVisible = await bLocator.isVisible();
    if (!bVisible) {
      const aEl = page.locator(`[data-testid="tree-node-${nodeA}"] > div`).first();
      await aEl.locator('span').first().click();
      await page.waitForTimeout(300);
    }

    await expect(bLocator).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(`[data-testid="tree-node-${nodeX}"]`)).toBeVisible({ timeout: 5_000 });

    await dragNodeToPosition(page, nodeX, nodeB, 'below');

    const children = await getNodeChildren(nodeA);
    const titles = children.map(c => c.card.title);
    const xIdx = titles.indexOf('CardX');
    const bIdx = titles.indexOf('CardB');
    const cIdx = titles.indexOf('CardC');
    expect(xIdx).toBeGreaterThan(bIdx);
    expect(xIdx).toBeLessThan(cIdx);
  });

  test('X를 C 뒤(below C)로 이동', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(`[data-testid="tree-node-${nodeA}"]`)).toBeVisible({ timeout: 15_000 });

    // A는 자동 펼쳐짐 — C가 안 보일 때만 toggle
    const cLocator = page.locator(`[data-testid="tree-node-${nodeC}"]`);
    const cVisible = await cLocator.isVisible();
    if (!cVisible) {
      const aEl = page.locator(`[data-testid="tree-node-${nodeA}"] > div`).first();
      await aEl.locator('span').first().click();
      await page.waitForTimeout(300);
    }

    await expect(cLocator).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(`[data-testid="tree-node-${nodeX}"]`)).toBeVisible({ timeout: 5_000 });

    await dragNodeToPosition(page, nodeX, nodeC, 'below');

    const children = await getNodeChildren(nodeA);
    const titles = children.map(c => c.card.title);
    const xIdx = titles.indexOf('CardX');
    const cIdx = titles.indexOf('CardC');
    expect(xIdx).toBeGreaterThan(cIdx);
  });
});
