import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Components } from 'react-markdown';
import type { CompileSection as Section } from '../../api/types';
import { CompileSection } from './CompileSection';
import { findTocHeading } from './compileToc';
import { useSectionContents } from './useSectionContents';

export interface CompileListHandle {
  jumpToHeading: (sectionIndex: number, headingIndex: number) => void;
  jumpToMatch: (sectionIndex: number) => void;
}

interface Props {
  sections: Section[];
  scrollRef: RefObject<HTMLDivElement | null>;
  headingComponents: Components;
}

function estimateBodyHeight(chars: number, width: number) {
  return Math.max(24, Math.ceil(chars * 520 / Math.max(width - 32, 1)));
}

export const CompileVirtualList = forwardRef<CompileListHandle, Props>(function CompileVirtualList(
  { sections, scrollRef, headingComponents }, ref,
) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const pendingHeading = useRef<{ sectionIndex: number; headingIndex: number } | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const { get, request } = useSectionContents(sections);
  // TanStack Virtual owns mutable measurements; this component is not compiled by React Compiler.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: sections.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: index => 44 + estimateBodyHeight(sections[index]?.chars ?? 0, scrollRef.current?.clientWidth ?? 600),
    overscan: 3,
    scrollMargin,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const start = virtualItems[0]?.index ?? 0;
  const end = virtualItems.at(-1)?.index ?? -1;
  const width = virtualizer.scrollRect?.width ?? 600;

  const setList = useCallback((element: HTMLDivElement | null) => {
    listRef.current = element;
    const scroll = scrollRef.current;
    if (element && scroll) setScrollMargin(element.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop);
  }, [scrollRef]);

  useEffect(() => {
    if (end < 0) return;
    const frame = requestAnimationFrame(() => {
      const first = Math.max(0, start - 10);
      const last = Math.min(sections.length - 1, end + 10);
      request(Array.from({ length: last - first + 1 }, (_, index) => first + index));
    });
    return () => cancelAnimationFrame(frame);
  }, [start, end, request, sections]);

  const finishHeading = useCallback(() => {
    const pending = pendingHeading.current;
    const scroll = scrollRef.current;
    const section = pending && sections[pending.sectionIndex];
    const element = pending && listRef.current?.querySelector<HTMLElement>(`[data-section-index="${pending.sectionIndex}"]`);
    if (!pending || !scroll || !section || !element || element.dataset.loaded !== 'true') return;
    const target = pending.headingIndex < 0 ? element : findTocHeading(element, section, pending.headingIndex) ?? element;
    const align = () => { scroll.scrollTop += target.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 16; };
    align();
    requestAnimationFrame(align);
    pendingHeading.current = null;
  }, [scrollRef, sections]);

  useEffect(() => {
    if (!pendingHeading.current) return;
    const frame = requestAnimationFrame(finishHeading);
    return () => cancelAnimationFrame(frame);
  });

  useImperativeHandle(ref, () => ({
    jumpToHeading(sectionIndex, headingIndex) {
      pendingHeading.current = { sectionIndex, headingIndex };
      virtualizer.scrollToIndex(sectionIndex, { align: 'start' });
      request([sectionIndex]);
      requestAnimationFrame(finishHeading);
    },
    jumpToMatch(sectionIndex) {
      pendingHeading.current = null;
      virtualizer.scrollToIndex(sectionIndex, { align: 'center' });
      request([sectionIndex]);
    },
  }), [finishHeading, request, virtualizer]);

  return <div ref={setList} style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
    {virtualItems.map(item => {
      const section = sections[item.index]!;
      const content = get(section);
      const loaded = content !== undefined || section.chars === 0 || section.cycle;
      return <div
        key={item.key}
        data-index={item.index}
        data-section-index={item.index}
        data-loaded={loaded}
        ref={virtualizer.measureElement}
        className="compile-section"
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start - scrollMargin}px)` }}
      >
        <CompileSection section={section} content={content} headingComponents={headingComponents} estimateBodyHeight={estimateBodyHeight(section.chars, width)} />
      </div>;
    })}
  </div>;
});
