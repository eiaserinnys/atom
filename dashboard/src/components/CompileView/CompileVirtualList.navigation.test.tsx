// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import type { CompileSection } from '../../api/types';
import { CompileVirtualList, type CompileListHandle } from './CompileVirtualList';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ getScrollElement }: { getScrollElement: () => HTMLElement }) => ({
    getVirtualItems: () => [{ index: 0, key: 0, start: 0 }],
    getTotalSize: () => 500,
    measureElement: () => {},
    scrollToIndex: () => {},
    scrollToOffset: (offset: number) => { getScrollElement().scrollTop = offset; },
    cancelScroll: () => {},
    scrollRect: { width: 600 },
  }),
}));

// Reuse the real component/Markdown and the createRoot pattern from the section
// transition test; different section/heading coordinates expose the margin gap.
test.each([-1, 0])('aligns the heading element at 16px for heading index %s', async headingIndex => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++next, cb); return next; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const section: CompileSection = {
    index: 0, node_id: 'node', card_id: 'card', card_version: 1,
    depth: 2, level: 3, heading: '### Card title', title: 'Card title', cycle: false,
    chars: 12, content: '## Body title', headings: [{ level: 2, text: 'Body title' }],
  };
  const scroll = document.createElement('div');
  scroll.getBoundingClientRect = () => ({ top: 100 } as DOMRect);
  document.body.append(scroll);
  const root = createRoot(scroll);
  const ref = createRef<CompileListHandle>();
  try {
    await act(async () => root.render(<CompileVirtualList ref={ref} sections={[section]} headingComponents={{}} scrollRef={{ current: scroll }} />));
    const element = scroll.querySelector<HTMLElement>('[data-section-index="0"]')!;
    const cardHeading = element.querySelector('h3')!;
    const bodyHeading = element.querySelector('h2')!;
    element.getBoundingClientRect = () => ({ top: 300 - scroll.scrollTop, height: 300 } as DOMRect);
    cardHeading.getBoundingClientRect = () => ({ top: 324 - scroll.scrollTop, height: 24 } as DOMRect);
    bodyHeading.getBoundingClientRect = () => ({ top: 390 - scroll.scrollTop, height: 24 } as DOMRect);
    await act(async () => ref.current!.jumpToHeading(0, headingIndex));
    await act(async () => {
      const callbacks = [...frames.values()]; frames.clear();
      callbacks.forEach(callback => callback(16));
    });
    const target = headingIndex < 0 ? cardHeading : bodyHeading;
    expect(target.getBoundingClientRect().top - scroll.getBoundingClientRect().top).toBe(16);
  } finally {
    act(() => root.unmount());
    scroll.remove();
    vi.unstubAllGlobals();
  }
});
