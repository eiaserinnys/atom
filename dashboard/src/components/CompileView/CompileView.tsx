import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Link2 } from 'lucide-react';
import { api, type UnfurlEntry } from '../../api/client';
import { readStoredCredentials } from '../../hooks/useLocalStorageCredentials';
import { UnfurlSectionList } from '../UnfurlSection';
import { parseCompileSections, type SectionMap } from '../../utils/parseCompileSections';
import { EditableHeading } from './EditableHeading';

interface CompileViewProps {
  nodeId: string | null;
}

interface TocEntry {
  id: string;
  text: string;
  level: number;
}

const TOC_WIDTH = 200;

export function CompileView({ nodeId }: CompileViewProps) {
  const { t } = useTranslation();
  const [unfurlEnabled, setUnfurlEnabled] = useState(false);

  // Standard compile (GET) — used when unfurl is disabled
  const standardQuery = useQuery({
    queryKey: ['compile', nodeId],
    queryFn: async () => {
      const result = await api.compile(nodeId!, { numbering: true, include_ids: true });
      return { markdown: result.markdown };
    },
    enabled: !!nodeId && !unfurlEnabled,
  });

  // Unfurl compile (POST) — credentials는 설정 탭에서 관리, 실행 시점에 localStorage에서 직접 읽음
  const unfurlQuery = useQuery({
    queryKey: ['compile-unfurl', nodeId],
    queryFn: async () => {
      return api.compileWithRefs(nodeId!, 2, 'cached', readStoredCredentials());
    },
    enabled: !!nodeId && unfurlEnabled,
  });

  const activeQuery = unfurlEnabled ? unfurlQuery : standardQuery;
  const markdown = activeQuery.data?.markdown;
  const isLoading = activeQuery.isLoading;
  const error = activeQuery.error;
  const unfurls = unfurlEnabled ? (unfurlQuery.data?.unfurls ?? null) : null;

  const contentRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [tocEntries, setTocEntries] = useState<TocEntry[]>([]);
  const [tocVisible, setTocVisible] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Build TOC from rendered headings
  useEffect(() => {
    if (!contentRef.current || !markdown) return;

    const timer = setTimeout(() => {
      const el = contentRef.current;
      if (!el) return;

      const headings = el.querySelectorAll('h1, h2, h3, h4, h5, h6');
      const entries: TocEntry[] = [];

      headings.forEach((heading, idx) => {
        const id = `compile-heading-${idx}`;
        heading.id = id;
        entries.push({
          id,
          text: heading.textContent ?? '',
          level: parseInt(heading.tagName[1]!),
        });
      });

      setTocEntries(entries);
    }, 50);

    return () => clearTimeout(timer);
  }, [markdown]);

  // Track active heading on scroll (RAF-throttled)
  const rafRef = useRef(0);
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

  const minLevel = useMemo(
    () => Math.min(...tocEntries.map((e) => e.level), 1),
    [tocEntries]
  );

  // 마크다운에서 섹션→카드ID 매핑 파싱 (편집 버튼 활성화용)
  const sectionMap: SectionMap = useMemo(
    () => (markdown ? parseCompileSections(markdown) : new Map()),
    [markdown]
  );

  // EditableHeading 컴포넌트 팩토리 (nodeId prop 클로저)
  const makeHeading = (level: number) =>
    ({ children }: { children?: React.ReactNode }) => (
      <EditableHeading level={level} sectionMap={sectionMap} compiledNodeId={nodeId!}>
        {children}
      </EditableHeading>
    );
  const headingComponents = nodeId
    ? {
        h1: makeHeading(1),
        h2: makeHeading(2),
        h3: makeHeading(3),
        h4: makeHeading(4),
        h5: makeHeading(5),
        h6: makeHeading(6),
      }
    : {};

  return (
    <div className="h-full flex flex-col bg-background border-r border-border">
      <div className="h-10 flex items-center px-4 border-b border-border bg-card text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground shrink-0">
        {t('compile.header')}
        {nodeId && (
          <div className="ml-auto flex items-center gap-1">
            <span className="px-2 py-0.5 text-xs font-mono bg-muted border border-border rounded-md text-muted-foreground">
              {nodeId.slice(0, 8)}
            </span>
            <button
              onClick={() => navigator.clipboard.writeText(nodeId)}
              className="p-1 rounded hover:bg-muted text-muted-foreground"
              title={t('compile.copy_id')}
            >
              <Copy className="w-3 h-3" />
            </button>
            <button
              onClick={() => setUnfurlEnabled((v) => !v)}
              className={`p-1 rounded text-muted-foreground transition-colors ${
                unfurlEnabled ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
              }`}
              title={unfurlEnabled ? t('compile.unfurl_disable') : t('compile.unfurl_enable')}
            >
              <Link2 className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden relative">
        {/* TOC hover zone — right edge */}
        {tocEntries.length > 0 && (
          <div
            className="absolute top-0 right-0 bottom-0 z-10"
            style={{ width: tocVisible ? TOC_WIDTH + 16 : 16 }}
            onMouseEnter={() => setTocVisible(true)}
            onMouseLeave={() => setTocVisible(false)}
          >
            {/* TOC panel */}
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
                    onClick={() => scrollTo(entry.id)}
                    className={`
                      block w-full text-left px-2 py-1 rounded text-xs leading-snug truncate
                      transition-colors duration-100
                      ${activeId === entry.id
                        ? 'text-foreground bg-muted font-medium'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}
                    `}
                    style={{ paddingLeft: `${(entry.level - minLevel) * 12 + 8}px` }}
                    title={entry.text}
                  >
                    {entry.text}
                  </button>
                ))}
              </nav>
            </div>

            {/* Hover indicator bar — visible when TOC is hidden */}
            {!tocVisible && (
              <div className="absolute top-1/3 right-1 w-1 h-1/3 rounded-full bg-muted-foreground/20" />
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto" ref={scrollContainerRef}>
          <div className="p-4" ref={contentRef}>
            {!nodeId && (
              <div className="text-muted-foreground text-sm">{t('compile.no_selection')}</div>
            )}
            {isLoading && <div className="text-muted-foreground text-sm">{t('compile.loading')}</div>}
            {error && <div className="text-node-error text-sm">{t('common.error')}: {(error as Error).message}</div>}
            {markdown && !isLoading && (
              <div className="
                text-foreground text-base leading-[1.7]
                [&_h1]:mt-4 [&_h1:first-child]:mt-0 [&_h1]:mb-[0.4em] [&_h1]:font-semibold [&_h1]:text-[1.4em]
                [&_h2]:mt-[1.4em] [&_h2]:mb-[0.4em] [&_h2]:font-semibold [&_h2]:text-[1.2em]
                [&_h3]:mt-[1.4em] [&_h3]:mb-[0.4em] [&_h3]:font-semibold [&_h3]:text-[1.05em]
                [&_h4]:mt-[1.4em] [&_h4]:mb-[0.4em] [&_h4]:font-semibold
                [&_p]:mb-[0.8em]
                [&_ul]:mb-[0.8em] [&_ul]:pl-6
                [&_ol]:mb-[0.8em] [&_ol]:pl-6
                [&_li]:mb-[0.2em]
                [&_code]:font-mono [&_code]:text-[0.88em] [&_code]:bg-muted [&_code]:border [&_code]:border-border [&_code]:rounded [&_code]:px-[0.35em] [&_code]:py-[0.1em]
                [&_pre]:bg-card [&_pre]:border [&_pre]:border-border [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:overflow-x-auto [&_pre]:mb-[1em]
                [&_pre_code]:bg-transparent [&_pre_code]:border-0 [&_pre_code]:p-0 [&_pre_code]:text-[0.88em]
                [&_blockquote]:border-l-[3px] [&_blockquote]:border-border [&_blockquote]:ml-0 [&_blockquote]:mb-[0.8em] [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground
                [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-border [&_hr]:my-4
                [&_a]:text-node-user [&_a]:no-underline hover:[&_a]:underline
              ">
                <Markdown remarkPlugins={[remarkGfm]} components={headingComponents}>{markdown}</Markdown>
              </div>
            )}

            {unfurls && Object.keys(unfurls).length > 0 && (
              <UnfurlSectionList unfurls={unfurls as Record<string, UnfurlEntry>} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
