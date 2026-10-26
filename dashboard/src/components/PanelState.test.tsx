// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { PanelState } from './PanelState';

test('centers panel state content with the shared spacing contract', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<PanelState><span>Empty tree</span></PanelState>));
    const panel = host.firstElementChild;
    expect(panel?.className).toBe('flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center');
    expect(panel?.textContent).toBe('Empty tree');
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
