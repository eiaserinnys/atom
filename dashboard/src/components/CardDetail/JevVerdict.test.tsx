// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { JevVerdict } from './JevVerdict';
import type { MotionNode } from '../SearchMotionView/types';
test('shows one verdict badge, hop metadata and a separate summary', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); const root = createRoot(host);
  const verdict: MotionNode = { nodeId: 'a', title: '카드', type: 'knowledge', path: ['상위'], summary: '질의에 맞는 내용', score: .78, selected: true, rank: 2, hop: 0, reason: '선정 2', sentText: '', sample: true };
  try {
    await act(async () => root.render(<JevVerdict verdict={verdict} />));
    expect(host.textContent).toContain('선정 #2 (0.78)');
    expect(host.textContent).not.toContain('선정 2');
    expect(host.textContent).toContain('입구 · 표본');
    expect(host.querySelector('p')?.textContent).toBe('질의에 맞는 내용');
    await act(async () => root.render(<JevVerdict verdict={{ ...verdict, selected: false, reason: '낮음', summary: null, path: ['상위', '경로'] }} />));
    expect(host.textContent?.match(/낮음/g)).toHaveLength(1);
    expect(host.querySelector('p')?.textContent).toBe('상위 › 경로');
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); }
});
