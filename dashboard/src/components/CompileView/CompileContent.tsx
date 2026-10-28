import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { Components } from 'react-markdown';
import type { CompileSection, UnfurlEntry } from '../../api/client';
import { UnfurlSectionList } from '../UnfurlSection';
import { PanelState } from '../PanelState';
import { Spinner } from '../Spinner';
import { CompileVirtualList, type CompileListHandle } from './CompileVirtualList';

interface CompileContentProps {
  scrollRef: RefObject<HTMLDivElement | null>;
  listRef: RefObject<CompileListHandle | null>;
  isLoading: boolean;
  error: Error | null;
  sections: CompileSection[] | undefined;
  headingComponents: Components;
  unfurls: Record<string, UnfurlEntry> | null;
}

export function CompileContent({
  scrollRef,
  listRef,
  isLoading,
  error,
  sections,
  headingComponents,
  unfurls,
}: CompileContentProps) {
  const { t } = useTranslation();

  return (
    <div className={isLoading || error ? 'h-full p-4 flex' : 'p-4'}>
      {isLoading && <PanelState><Spinner label={t('common.loading')} /></PanelState>}
      {error && <PanelState><p className="text-sm text-node-error">{t('common.error')}: {error.message}</p></PanelState>}
      {sections && !isLoading && (
        <div className="markdown-content">
          <CompileVirtualList ref={listRef} sections={sections} scrollRef={scrollRef} headingComponents={headingComponents} />
        </div>
      )}

      {unfurls && Object.keys(unfurls).length > 0 && (
        <UnfurlSectionList unfurls={unfurls} />
      )}
    </div>
  );
}
