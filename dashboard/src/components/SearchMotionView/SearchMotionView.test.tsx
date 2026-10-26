// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { test, expect, vi } from 'vitest';
import { SearchMotionView } from './SearchMotionView';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.mock('./player.js', () => ({ createMotionPlayer: (host: HTMLElement) => {
  const node = host.querySelector('[data-motion-id=query-title]')!;
  node.textContent = '재생 중인 질의';
  return { begin: vi.fn(), receive: vi.fn(), dispose: vi.fn(), error: vi.fn() };
} }));

test('keeps the canvas-owned DOM when ready, summary or parent results cause React to render again', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<SearchMotionView request={null} onSelectNode={vi.fn()} onResults={vi.fn()} />));
    expect(host.querySelector('[data-motion-id=query-title]')!.textContent).toBe('재생 중인 질의');
    await act(async () => root.render(<SearchMotionView request={null} onSelectNode={vi.fn()} onResults={vi.fn()} />));
    expect(host.querySelector('[data-motion-id=query-title]')!.textContent).toBe('재생 중인 질의');
  } finally { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
