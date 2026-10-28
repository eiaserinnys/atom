import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Components } from 'react-markdown';
import type { CompileSection as Section } from '../../api/types';
import { CompileSection } from './CompileSection';
import { findTocHeading } from './compileToc';
import { useSectionContents } from './useSectionContents';
import { findTextRanges } from './findTextRanges';
import { trackCompileTarget } from './compileScrollTarget';

export interface CompileListHandle {
  jumpToHeading: (sectionIndex: number, headingIndex: number) => void;
  jumpToMatch: (sectionIndex: number, query?: string, withinSection?: number) => void;
  cancelJump: () => void;
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
  const stopTracking = useRef<(() => void) | null>(null);
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

  const cancelJump = useCallback(() => { stopTracking.current?.(); stopTracking.current = null; }, []);
  useEffect(() => cancelJump, [cancelJump, sections]);

  const jump = useCallback((sectionIndex: number, headingIndex: number | null, query?: string, withinSection = 0) => {
    cancelJump();
    const scroll = scrollRef.current;
    const section = sections[sectionIndex];
    if (!scroll || !section) return;
    const align = headingIndex === null ? 'center' : 'start';
    const reveal = () => virtualizer.scrollToIndex(sectionIndex, { align });
    reveal();
    request([sectionIndex]);
    stopTracking.current = trackCompileTarget(scroll, {
      align, reveal,
      cancelScroll: () => virtualizer.cancelScroll(),
      write: offset => virtualizer.scrollToOffset(offset),
      locate: () => {
        const element = listRef.current?.querySelector<HTMLElement>(`[data-section-index="${sectionIndex}"]`);
        if (!element || element.dataset.loaded !== 'true') return null;
        const target = headingIndex === null
          ? query ? findTextRanges(element, query)[withinSection] : element
          : headingIndex < 0 ? element : findTocHeading(element, section, headingIndex) ?? element;
        if (!target) return null;
        // A loaded target can look stable while bodies above it are still in flight.
        const ready = !Array.from(listRef.current!.querySelectorAll<HTMLElement>('[data-loaded="false"]'))
          .some(el => Number(el.dataset.sectionIndex) < sectionIndex);
        const rect = target.getBoundingClientRect();
        return { top: rect.top, height: rect.height, ready };
      },
    });
  }, [cancelJump, request, scrollRef, sections, virtualizer]);

  useImperativeHandle(ref, () => ({
    jumpToHeading(sectionIndex, headingIndex) {
      jump(sectionIndex, headingIndex);
    },
    jumpToMatch(sectionIndex, query, withinSection) {
      jump(sectionIndex, null, query, withinSection);
    },
    cancelJump,
  }), [cancelJump, jump]);

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
