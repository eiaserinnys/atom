import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import type { UnfurlEntry } from '../../api/client';
import { UnfurlSectionList } from '../UnfurlSection';

interface CompileContentProps {
  contentRef: RefObject<HTMLDivElement | null>;
  nodeId: string | null;
  isLoading: boolean;
  error: Error | null;
  markdown: string | undefined;
  processedMarkdown: string | undefined;
  headingComponents: Components;
  unfurls: Record<string, UnfurlEntry> | null;
}

export function CompileContent({
  contentRef,
  nodeId,
  isLoading,
  error,
  markdown,
  processedMarkdown,
  headingComponents,
  unfurls,
}: CompileContentProps) {
  const { t } = useTranslation();

  return (
    <div className="p-4" ref={contentRef}>
      {!nodeId && (
        <div className="text-muted-foreground text-sm">{t('compile.no_selection')}</div>
      )}
      {isLoading && <div className="text-muted-foreground text-sm">{t('compile.loading')}</div>}
      {error && <div className="text-node-error text-sm">{t('common.error')}: {error.message}</div>}
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
