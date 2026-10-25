// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import App from './App';
import type { MotionNode } from './components/SearchMotionView/types';
const sample: MotionNode = { nodeId: 'virtual-rose', title: '이전 표본 카드', type: 'knowledge', path: ['식물'], summary: '이전 표본 본문', score: .9, selected: true, rank: 1, hop: 2, reason: '선정 1', sentText: '', sample: true };
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./hooks/useAuth', () => ({ useAuth: () => ({ authenticated: true, role: 'admin' }) }));
vi.mock('./hooks/useMobile', () => ({ useMobile: () => false }));
vi.mock('./hooks/useAtomEvents', () => ({ useAtomEvents() {} }));
vi.mock('./contexts/SystemContext', () => ({ SystemProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('./components/RestartBanner', () => ({ RestartBanner: () => null }));
vi.mock('./components/ReconnectOverlay', () => ({ ReconnectOverlay: () => null }));
vi.mock('./components/ThemeToggle', () => ({ ThemeToggle: () => null }));
vi.mock('./components/Config/ConfigModal', () => ({ ConfigModal: () => null }));
vi.mock('./components/Layout/MobileLayout', () => ({ MobileLayout: () => null }));
vi.mock('./pages/LoginPage', () => ({ LoginPage: () => null }));
vi.mock('./components/TreeView/TreeView', () => ({ TreeView: () => null }));
vi.mock('./components/Layout/ThreePanelLayout', () => ({ ThreePanelLayout: ({ center, right }: { center: ReactNode; right: ReactNode }) => <>{center}{right}</> }));
vi.mock('./components/SearchBar/SearchBar', () => ({ SearchBar: ({ onSubmitJevSearch }: { onSubmitJevSearch: (query: string, options: object) => void }) => <button onClick={() => onSubmitJevSearch('새 검색', {})}>새 검색</button> }));
vi.mock('./components/Layout/CenterWorkspace', () => ({ CenterWorkspace: ({ onResults, onSelectNode }: { onResults: (nodes: MotionNode[]) => void; onSelectNode: (id: string, node: MotionNode) => void }) => <>
  <button onClick={() => { onResults([sample]); onSelectNode(sample.nodeId!, sample); }}>표본 선택</button>
  <button onClick={() => onResults([])}>표본 전환</button>
</> }));
vi.mock('./components/CardDetail/CardDetail', () => ({ CardDetail: ({ nodeId, verdict }: { nodeId: string | null; verdict: MotionNode | null }) => <output>{verdict?.title ?? nodeId ?? '선택 없음'}</output> }));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(async () => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root.render(<App />)); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function click(label: string) { await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === label)!.click()); }
for (const action of ['새 검색', '표본 전환']) test(`${action} clears the previous virtual sample detail and verdict`, async () => {
  await click('표본 선택'); expect(host.querySelector('output')!.textContent).toBe('이전 표본 카드');
  await click(action); expect(host.querySelector('output')!.textContent).toBe('선택 없음');
});
