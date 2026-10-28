import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { compileApi } from '../../api/compileApi';
import { compileFindQueryKey } from '../../query/queryKeys';
import type { CompileListHandle } from './CompileVirtualList';
import { findTextRanges } from './findTextRanges';

interface Occurrence { sectionIndex: number; withinSection: number }
interface Pending { index: number; direction: 1 | -1; tried: number }

function clearHighlights() {
  if (typeof CSS !== 'undefined' && CSS.highlights) {
    CSS.highlights.delete('compile-find');
    CSS.highlights.delete('compile-find-current');
  }
}

function paintHighlights(scroll: HTMLElement, query: string, occurrences: Occurrence[], current: number) {
  if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return;
  const all: Range[] = [];
  let selected: Range | undefined;
  for (const element of scroll.querySelectorAll<HTMLElement>('[data-section-index][data-loaded="true"]')) {
    const ranges = findTextRanges(element, query);
    all.push(...ranges);
    const match = occurrences[current];
    if (match && match.sectionIndex === Number(element.dataset.sectionIndex)) selected = ranges[match.withinSection];
  }
  CSS.highlights.set('compile-find', new Highlight(...all));
  if (selected) CSS.highlights.set('compile-find-current', new Highlight(selected));
  else CSS.highlights.delete('compile-find-current');
}

export function useCompileFind(
  nodeId: string | null, depth: number, open: boolean,
  scrollRef: RefObject<HTMLDivElement | null>, listRef: RefObject<CompileListHandle | null>,
) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [current, setCurrent] = useState(-1);
  const pending = useRef<Pending | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const term = debounced === query.trim() ? debounced : '';
  const result = useQuery({
    queryKey: compileFindQueryKey(nodeId, depth, term),
    queryFn: () => compileApi.find(nodeId!, depth, term),
    enabled: open && !!nodeId && term.length > 0 && term.length <= 200,
  });
  const occurrences = useMemo(() => {
    if (!term || !result.data) return [];
    return result.data.matches.flatMap(match => Array.from({ length: match.count }, (_, withinSection) => ({ sectionIndex: match.index, withinSection })));
  }, [result.data, term]);

  const resolve = useCallback(function resolve() {
    const scroll = scrollRef.current;
    if (!scroll || !open || !term) return;
    const target = pending.current;
    let paintedCurrent = current;
    if (target) {
      const occurrence = occurrences[target.index];
      const element = occurrence && scroll.querySelector<HTMLElement>(`[data-section-index="${occurrence.sectionIndex}"]`);
      if (occurrence && element?.dataset.loaded === 'true') {
        const range = findTextRanges(element, term)[occurrence.withinSection];
        if (range) {
          const rect = range.getBoundingClientRect();
          const scrollRect = scroll.getBoundingClientRect();
          scroll.scrollTop += rect.top + rect.height / 2 - scrollRect.top - scroll.clientHeight / 2;
          paintedCurrent = target.index;
          pending.current = null;
          setCurrent(target.index);
        } else if (target.tried + 1 >= occurrences.length) {
          pending.current = null;
          paintedCurrent = -1;
          setCurrent(-1);
        } else {
          const index = (target.index + target.direction + occurrences.length) % occurrences.length;
          pending.current = { ...target, index, tried: target.tried + 1 };
          listRef.current?.jumpToMatch(occurrences[index]!.sectionIndex);
          requestAnimationFrame(resolve);
        }
      }
    }
    paintHighlights(scroll, term, occurrences, paintedCurrent);
  }, [current, listRef, occurrences, open, scrollRef, term]);

  const navigate = useCallback((direction: 1 | -1) => {
    if (occurrences.length === 0) return;
    const index = current < 0 ? (direction === 1 ? 0 : occurrences.length - 1) : (current + direction + occurrences.length) % occurrences.length;
    pending.current = { index, direction, tried: 0 };
    listRef.current?.jumpToMatch(occurrences[index]!.sectionIndex);
    requestAnimationFrame(resolve);
  }, [current, listRef, occurrences, resolve]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || !open || !term) { clearHighlights(); return; }
    let frame = 0;
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(resolve); };
    const observer = new MutationObserver(schedule);
    observer.observe(scroll, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-loaded'] });
    scroll.addEventListener('scroll', schedule, { passive: true });
    schedule();
    return () => {
      observer.disconnect();
      scroll.removeEventListener('scroll', schedule);
      cancelAnimationFrame(frame);
      clearHighlights();
    };
  }, [open, resolve, scrollRef, term]);

  const changeQuery = useCallback((value: string) => {
    pending.current = null;
    setCurrent(-1);
    setQuery(value);
  }, []);
  return { query, changeQuery, navigate, current: current + 1, total: occurrences.length };
}
