// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { MobileLayout } from '../Layout/MobileLayout';
import type { MotionNode } from './types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ role: 'admin', email: '' }) }));
vi.mock('../TreeView/TreeView', () => ({ TreeView: () => <output data-testid="tree">Tree</output> }));
vi.mock('../CompileView/CompileView', () => ({ CompileView: () => null }));
vi.mock('../Config/MobileSettingsPage', () => ({ MobileSettingsPage: () => null }));
vi.mock('../CardDetail/CardDetail', () => ({ CardDetail: ({ nodeId }: { nodeId: string }) => <output data-testid="detail">{nodeId}</output> }));
vi.mock('./LazySearchMotionView', () => ({ LazySearchMotionView: ({ onSelectNode, onOpenInTree }: { onSelectNode: (id: string, node: MotionNode) => void; onOpenInTree: (id: string) => void }) => <>
  <button onClick={() => onSelectNode('chosen', { nodeId: 'chosen' } as MotionNode)}>Choose node</button>
  <button onClick={() => onOpenInTree('chosen')}>Open tree</button>
</> }));

test('graph selection stays in search, detail follows it, and only explicit tree opening changes the tab', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const reveal = vi.fn();
  function Harness() {
    const [id, setId] = useState<string | null>(null);
    return <MobileLayout selectedNodeId={id} onSelectNode={setId} request={{ query: 'q', requestId: 1 }} searchResults={[]} verdict={null} onSearchSelect={setId} onSubmitSearch={vi.fn()} onResults={vi.fn()} onOpenInTree={reveal} />;
  }
  const click = async (text: string) => act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === text)!.click());
  try {
    await act(async () => root.render(<Harness />));
    await click('Choose node');
    expect(host.querySelector('[role=tab][aria-selected=true]')!.textContent).toBe('mobile.tab_search');
    await click('mobile.tab_detail');
    expect(host.querySelector('[data-testid=detail]')!.textContent).toBe('chosen');
    await click('mobile.tab_search');
    await click('Open tree');
    expect(reveal).toHaveBeenCalledWith('chosen');
    expect(host.querySelector('[role=tab][aria-selected=true]')!.textContent).toBe('mobile.tab_tree');
  } finally { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
