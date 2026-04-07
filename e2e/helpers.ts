import type { Page } from '@playwright/test';

const TEST_API_BASE_RESET = 'http://127.0.0.1:14200';

/**
 * Reset the server-side DB by calling DELETE /test/reset.
 * The server must be running (Playwright webServer ensures this during test runs).
 * This avoids deleting the SQLite file while the server has it open — a pattern
 * that leaves stale data across test runs because the server keeps the fd alive.
 */
export async function resetTestDb(): Promise<void> {
  const res = await fetch(`${TEST_API_BASE_RESET}/test/reset`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) {
    throw new Error(`resetTestDb failed: ${res.status} ${await res.text()}`);
  }
}

const TEST_API_BASE = 'http://127.0.0.1:14200';

export interface TestTreeNode {
  id: string;
  card: { title: string; card_type: string };
  position: number;
  parent_node_id: string | null;
}

/** bypass 모드에서 로그인 없이 카드 생성 (POST /cards) */
export async function createTestCard(opts: {
  card_type: 'structure' | 'knowledge';
  title: string;
  parent_node_id?: string | null;
  content?: string;
}): Promise<{ node_id: string; card_id: string }> {
  const res = await fetch(`${TEST_API_BASE}/cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      card_type: opts.card_type,
      title: opts.title,
      parent_node_id: opts.parent_node_id ?? null,
      content: opts.content ?? null,
    }),
  });
  if (!res.ok) throw new Error(`createTestCard failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as Record<string, unknown>;
  // POST /cards 응답: { ...card, node_id }
  return { node_id: data['node_id'] as string, card_id: data['id'] as string };
}

/** 루트 노드 목록 조회 */
export async function getTreeRoots(): Promise<TestTreeNode[]> {
  const res = await fetch(`${TEST_API_BASE}/tree`);
  if (!res.ok) throw new Error(`getTreeRoots failed: ${res.status}`);
  return res.json() as Promise<TestTreeNode[]>;
}

/** 특정 노드의 직계 자식 조회 */
export async function getNodeChildren(nodeId: string): Promise<TestTreeNode[]> {
  const res = await fetch(`${TEST_API_BASE}/tree/${nodeId}/children`);
  if (!res.ok) throw new Error(`getNodeChildren failed: ${res.status}`);
  return res.json() as Promise<TestTreeNode[]>;
}

/**
 * DnD 헬퍼: sourceNodeId를 targetNodeId의 위/아래/안으로 드래그한다.
 * PointerSensor activationConstraint distance=5px 초과를 위해 10px 이동 후 목표로 이동.
 * calcDropZone 임계값 (ratio < 0.3 = above, > 0.7 = below, 중간 = into)에 맞춰 Y 좌표 계산.
 */
export async function dragNodeToPosition(
  page: Page,
  sourceNodeId: string,
  targetNodeId: string,
  zone: 'above' | 'into' | 'below'
): Promise<void> {
  const sourceEl = page.locator(`[data-testid="tree-node-${sourceNodeId}"] > div`).first();
  const targetEl = page.locator(`[data-testid="tree-node-${targetNodeId}"] > div`).first();

  const sourceBB = await sourceEl.boundingBox();
  const targetBB = await targetEl.boundingBox();
  if (!sourceBB || !targetBB) throw new Error(`Node not visible: source=${sourceNodeId}, target=${targetNodeId}`);

  const startX = sourceBB.x + sourceBB.width / 2;
  const startY = sourceBB.y + sourceBB.height / 2;

  // calcDropZone 임계값 기준 Y 계산
  let targetY: number;
  if (zone === 'above') {
    targetY = targetBB.y + targetBB.height * 0.15; // ratio ≈ 0.15 < 0.3
  } else if (zone === 'into') {
    targetY = targetBB.y + targetBB.height * 0.5;  // ratio ≈ 0.5, structure → into
  } else {
    targetY = targetBB.y + targetBB.height * 0.85; // ratio ≈ 0.85 > 0.7
  }
  const targetX = targetBB.x + targetBB.width / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // activationConstraint distance=5px 초과 (10px 이동)
  await page.mouse.move(startX, startY - 10, { steps: 3 });
  // 목표 위치로 이동
  await page.mouse.move(targetX, targetY, { steps: 15 });
  await page.mouse.up();

  // tree re-render 대기
  await page.waitForTimeout(800);
}
