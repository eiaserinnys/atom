import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildTocEntriesFromHeadings,
  getTocMinLevel,
  type TocEntry,
} from './compileToc';

export function useCompileToc(markdown: string | undefined) {
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [tocEntries, setTocEntries] = useState<TocEntry[]>([]);
  const [tocVisible, setTocVisible] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!contentRef.current || !markdown) return;

    const timer = setTimeout(() => {
      const el = contentRef.current;
      if (!el) return;

      const headings = Array.from(el.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4, h5, h6'));
      const entries = buildTocEntriesFromHeadings(headings);
      headings.forEach((heading, index) => {
        heading.id = entries[index]!.id;
      });

      setTocEntries(entries);
    }, 50);

    return () => clearTimeout(timer);
  }, [markdown]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || tocEntries.length === 0) return;

    const handleScroll = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const scrollTop = container.scrollTop;
        let current: string | null = null;

        for (const entry of tocEntries) {
          const el = document.getElementById(entry.id);
          if (el && el.offsetTop <= scrollTop + 60) {
            current = entry.id;
          }
        }

        setActiveId(current);
      });
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => {
      container.removeEventListener('scroll', handleScroll);
      cancelAnimationFrame(rafRef.current);
    };
  }, [tocEntries]);

  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    const container = scrollContainerRef.current;
    if (!el || !container) return;
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    container.scrollTo({
      top: container.scrollTop + (elRect.top - containerRect.top) - 16,
      behavior: 'smooth',
    });
  }, []);

  const minLevel = useMemo(() => getTocMinLevel(tocEntries), [tocEntries]);

  return {
    contentRef,
    scrollContainerRef,
    tocEntries,
    tocVisible,
    setTocVisible,
    activeId,
    scrollTo,
    minLevel,
  };
}
