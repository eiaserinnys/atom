// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { expect, test, vi } from 'vitest';
import { JevVerdict } from './JevVerdict';
import type { MotionNode } from '../SearchMotionView/types';
import korean from '../../locales/ko/translation.json';
test('shows one verdict badge, hop metadata and a separate summary', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); const root = createRoot(host);
  const i18n = i18next.createInstance();
  await i18n.init({ lng: 'ko', resources: { ko: { translation: korean } }, initAsync: false });
  const verdict: MotionNode = { nodeId: 'a', title: '카드', type: 'knowledge', path: ['상위'], summary: '질의에 맞는 내용', score: .78, selected: true, rank: 2, hop: 0, columnLabel: '입구 · 표본', reason: '기존 이유', sentText: '', sample: true };
  try {
    await act(async () => root.render(<I18nextProvider i18n={i18n}><JevVerdict verdict={verdict} /></I18nextProvider>));
    expect(host.textContent).toContain('선정 2 (0.78)');
    expect(host.textContent).not.toContain('기존 이유');
    expect(host.textContent).toContain('입구 · 표본');
    expect(host.querySelector('p')?.textContent).toBe('질의에 맞는 내용');
    await act(async () => root.render(<I18nextProvider i18n={i18n}><JevVerdict verdict={{ ...verdict, selected: false, reason: '낮음', summary: null, path: ['상위', '경로'] }} /></I18nextProvider>));
    expect(host.textContent?.match(/낮음/g)).toHaveLength(1);
    expect(host.querySelector('p')?.textContent).toBe('상위 › 경로');
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); }
});
