// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import type { CompileSection as Section } from '../../api/types';
import { CompileSection } from './CompileSection';

const renders = vi.hoisted(() => ({ markdown: 0 }));
vi.mock('react-markdown', () => ({ default: ({ children }: { children: string }) => { renders.markdown++; return <div>{children}</div>; } }));

test('scroll-driven parent renders do not parse an unchanged section again', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const section: Section = { index: 0, node_id: 'n', card_id: 'c', card_version: 1, depth: 0, level: 1, heading: '# Title', title: 'Title', cycle: false, chars: 4, headings: [] };
  const components = {};
  function Parent() {
    const [, update] = useState(0);
    return <div onScroll={() => update(n => n + 1)}><CompileSection section={section} content="body" headingComponents={components} estimateBodyHeight={20} /></div>;
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Parent />));
  const before = renders.markdown;
  await act(async () => host.firstElementChild!.dispatchEvent(new Event('scroll')));
  expect(renders.markdown).toBe(before);
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
