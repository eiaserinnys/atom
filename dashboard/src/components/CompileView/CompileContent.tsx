import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import type { UnfurlEntry } from '../../api/client';
import { UnfurlSectionList } from '../UnfurlSection';
import { PanelState } from '../PanelState';
import { Spinner } from '../Spinner';

interface CompileContentProps {
  contentRef: RefObject<HTMLDivElement | null>;
  isLoading: boolean;
  error: Error | null;
  markdown: string | undefined;
  processedMarkdown: string | undefined;
  headingComponents: Components;
  unfurls: Record<string, UnfurlEntry> | null;
}

export function CompileContent({
  contentRef,
  isLoading,
  error,
  markdown,
  processedMarkdown,
  headingComponents,
  unfurls,
}: CompileContentProps) {
  const { t } = useTranslation();

  return (
    <div className={isLoading || error ? 'h-full p-4 flex' : 'p-4'} ref={contentRef}>
      {isLoading && <PanelState><Spinner label={t('common.loading')} /></PanelState>}
      {error && <PanelState><p className="text-sm text-node-error">{t('common.error')}: {error.message}</p></PanelState>}
      {markdown && !isLoading && (
        <div className="markdown-content">
          <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} components={headingComponents}>{processedMarkdown}</Markdown>
        </div>
      )}

      {unfurls && Object.keys(unfurls).length > 0 && (
        <UnfurlSectionList unfurls={unfurls} />
      )}
    </div>
  );
}
