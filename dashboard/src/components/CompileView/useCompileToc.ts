import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { CompileSection } from '../../api/types';
import { buildTocEntriesFromSections, findTocHeading, getTocMinLevel } from './compileToc';

export function useCompileToc(sections: CompileSection[], scrollRef: RefObject<HTMLDivElement | null>) {
  const entries = useMemo(() => buildTocEntriesFromSections(sections), [sections]);
  const minLevel = useMemo(() => getTocMinLevel(entries), [entries]);
  const [visible, setVisible] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    let frame = 0;
    const update = () => {
      const edge = scroll.getBoundingClientRect().top + 60;
      const elements = Array.from(scroll.querySelectorAll<HTMLElement>('[data-section-index]'));
      let current = elements[0];
      for (const element of elements) {
        if (element.getBoundingClientRect().top <= edge) current = element;
        else break;
      }
      const sectionIndex = Number(current?.dataset.sectionIndex);
      const section = sections[sectionIndex];
      if (!current || !section) return;
      let active = entries.find(entry => entry.sectionIndex === sectionIndex && entry.headingIndex === -1)?.id ?? null;
      for (const entry of entries) {
        if (entry.sectionIndex !== sectionIndex || entry.headingIndex < 0) continue;
        const heading = findTocHeading(current, section, entry.headingIndex);
        if (heading && heading.getBoundingClientRect().top <= edge) active = entry.id;
      }
      setActiveId(active);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(scroll, { childList: true, subtree: true });
    scroll.addEventListener('scroll', schedule, { passive: true });
    schedule();
    return () => {
      observer.disconnect();
      scroll.removeEventListener('scroll', schedule);
      cancelAnimationFrame(frame);
    };
  }, [entries, scrollRef, sections]);

  return { entries, minLevel, visible, setVisible, activeId };
}
