import { useTranslation } from 'react-i18next';
import {
  TOC_WIDTH,
  getTocEntryPaddingLeft,
  type TocEntry,
} from './compileToc';

interface CompileTocProps {
  tocEntries: TocEntry[];
  tocVisible: boolean;
  activeId: string | null;
  minLevel: number;
  onVisibleChange: (visible: boolean) => void;
  onScrollTo: (id: string) => void;
}

export function CompileToc({
  tocEntries,
  tocVisible,
  activeId,
  minLevel,
  onVisibleChange,
  onScrollTo,
}: CompileTocProps) {
  const { t } = useTranslation();

  if (tocEntries.length === 0) return null;

  return (
    <div
      className="absolute top-0 right-0 bottom-0 z-10"
      style={{ width: tocVisible ? TOC_WIDTH + 16 : 16 }}
      onMouseEnter={() => onVisibleChange(true)}
      onMouseLeave={() => onVisibleChange(false)}
    >
      <div
        className={`
          absolute top-0 right-0 bottom-0 overflow-y-auto
          bg-background/95 backdrop-blur-sm border-l border-border
          transition-all duration-200 ease-out
          ${tocVisible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2 pointer-events-none'}
        `}
        style={{ width: TOC_WIDTH }}
      >
        <div className="px-3 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          {t('compile.toc_title')}
        </div>
        <nav className="px-1 pb-3">
          {tocEntries.map((entry) => (
            <button
              key={entry.id}
              onClick={() => onScrollTo(entry.id)}
              className={`
                block w-full text-left px-2 py-1 rounded text-xs leading-snug truncate
                transition-colors duration-100
                ${activeId === entry.id
                  ? 'text-foreground bg-muted font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}
              `}
              style={{ paddingLeft: `${getTocEntryPaddingLeft(entry, minLevel)}px` }}
              title={entry.text}
            >
              {entry.text}
            </button>
          ))}
        </nav>
      </div>

      {!tocVisible && (
        <div className="absolute top-1/3 right-1 w-1 h-1/3 rounded-full bg-muted-foreground/20" />
      )}
    </div>
  );
}
