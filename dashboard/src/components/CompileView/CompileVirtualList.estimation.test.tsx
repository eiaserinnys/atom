// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import type { CompileSection } from '../../api/types';
import { CompileVirtualList } from './CompileVirtualList';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ estimateSize }: { estimateSize: (index: number) => number }) => {
    const estimatedHeight = estimateSize(0);
    return {
      getVirtualItems: () => [],
      getTotalSize: () => estimatedHeight,
      measureElement: () => {},
      scrollToIndex: () => {},
      scrollToOffset: () => {},
      cancelScroll: () => {},
      scrollRect: { width: 647 },
    };
  },
}));

test('estimates a representative measured section slightly above its rendered height', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const section: CompileSection = {
    index: 0, node_id: 'node', card_id: 'card', card_version: 1,
    depth: 0, level: 1, heading: '# Title', title: 'Title', cycle: false, chars: 263, headings: [],
  };
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 647 });
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<CompileVirtualList sections={[section]} headingComponents={{}} scrollRef={{ current: host }} />));
    const measuredHeight = 246.28125;
    const estimatedHeight = Number.parseFloat(host.querySelector('div')!.style.height);
    expect(estimatedHeight).toBeGreaterThanOrEqual(measuredHeight);
    expect(estimatedHeight).toBeLessThan(measuredHeight * 1.2);
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
