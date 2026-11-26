import { useRef, type RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import type { CompileSection } from '../../api/types';
import { TOC_WIDTH, getTocEntryPaddingLeft } from './compileToc';
import type { CompileListHandle } from './CompileVirtualList';
import { useCompileToc } from './useCompileToc';

interface Props {
  sections: CompileSection[];
  scrollRef: RefObject<HTMLDivElement | null>;
  listRef: RefObject<CompileListHandle | null>;
}

const TOC_ROW_HEIGHT = 26;
const TOC_HEADER_HEIGHT = 42;

export function CompileToc({ sections, scrollRef, listRef }: Props) {
  const { t } = useTranslation();
  const { entries, minLevel, visible, setVisible, activeId } = useCompileToc(sections, scrollRef);
  const tocScroll = useRef<HTMLDivElement>(null);
  // TanStack Virtual owns mutable measurements; this component is not compiled by React Compiler.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: entries.length + 1,
    getScrollElement: () => tocScroll.current,
    estimateSize: index => index === 0 ? TOC_HEADER_HEIGHT : TOC_ROW_HEIGHT,
    overscan: 5,
  });
  if (entries.length === 0) return null;

  return <div
    className="absolute top-0 right-0 bottom-0 z-10"
    style={{ width: visible ? TOC_WIDTH + 16 : 16 }}
    onMouseEnter={() => setVisible(true)}
    onMouseLeave={() => setVisible(false)}
  >
    <div
      ref={tocScroll}
      className={`absolute top-0 right-0 bottom-0 overflow-y-auto bg-background/95 backdrop-blur-sm border-l border-border transition-all duration-200 ease-out ${visible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2 pointer-events-none'}`}
      style={{ width: TOC_WIDTH }}
    >
      <nav className="pb-3" style={{ height: virtualizer.getTotalSize(), boxSizing: 'content-box', position: 'relative' }}>
        {virtualizer.getVirtualItems().map(row => {
          const style = { position: 'absolute' as const, top: 0, left: 0, width: '100%', transform: `translateY(${row.start}px)` };
          if (row.index === 0) return <div key="title" className="px-3 py-3 text-[13px] font-semibold text-muted-foreground uppercase tracking-wider" style={style}>{t('compile.toc_title')}</div>;
          const entry = entries[row.index - 1]!;
          return <div key={entry.id} className="px-1" style={style}>
            <button
              onClick={() => listRef.current?.jumpToHeading(entry.sectionIndex, entry.headingIndex)}
              className={`block w-full text-left px-2 py-1 rounded-none text-[13px] leading-snug truncate transition-colors duration-100 ${activeId === entry.id ? 'text-foreground bg-muted font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}
              style={{ paddingLeft: `${getTocEntryPaddingLeft(entry, minLevel)}px` }}
              title={entry.text}
            >{entry.text}</button>
          </div>;
        })}
      </nav>
    </div>
    {!visible && <div className="absolute top-1/3 right-1 w-1 h-1/3 rounded-none bg-muted-foreground/20" />}
  </div>;
}
