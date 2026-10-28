// @vitest-environment jsdom
import { act, createRef, memo, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { compileApi } from '../../api/compileApi';
import type { CompileContentsResponse, CompileSection } from '../../api/types';
import { CompileVirtualList, type CompileListHandle } from './CompileVirtualList';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [{ index: 0, key: 0, start: 0 }],
    getTotalSize: () => 100,
    measureElement: () => {},
    scrollToIndex: () => {},
    scrollRect: { width: 600 },
  }),
}));

test('an urgent edit commits before loaded content, which appears together with its loaded marker', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  let resolve!: (response: CompileContentsResponse) => void;
  const response = new Promise<CompileContentsResponse>(done => { resolve = done; });
  vi.spyOn(compileApi, 'contents').mockReturnValue(response);
  const section: CompileSection = {
    index: 0, node_id: 'node', card_id: 'card', card_version: 1,
    depth: 0, level: 1, heading: '# Title', title: 'Title', cycle: false, chars: 4, headings: [],
  };
  const sections = [section];
  const components = {};
  const host = document.createElement('div');
  document.body.append(host);
  const scrollRef = { current: host };
  const listRef = createRef<CompileListHandle>();
  const VirtualList = memo(CompileVirtualList);
  const commits: { text: string; loaded: string | null; content: string }[] = [];
  let setText!: (text: string) => void;

  function Screen() {
    const [text, updateText] = useState('');
    useLayoutEffect(() => {
      setText = updateText;
      const element = host.querySelector('[data-section-index="0"]');
      commits.push({ text, loaded: element?.getAttribute('data-loaded') ?? null, content: element?.textContent ?? '' });
    }, [text]);
    return <><input value={text} readOnly /><VirtualList sections={sections} headingComponents={components} scrollRef={scrollRef} ref={listRef} /></>;
  }

  const root = createRoot(host);
  try {
    await act(async () => root.render(<Screen />));
    await act(async () => listRef.current!.jumpToMatch(0));
    await act(async () => {
      resolve({ contents: { card: { version: 1, content: 'body' } } });
      for (let i = 0; i < 6; i++) await Promise.resolve();
      setText('typed');
    });
    expect(commits).toContainEqual({ text: 'typed', loaded: 'false', content: 'Title' });
    const element = host.querySelector('[data-section-index="0"]')!;
    expect(element.getAttribute('data-loaded')).toBe('true');
    expect(element.textContent).toContain('body');
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
