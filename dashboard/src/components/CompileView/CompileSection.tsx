import { memo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import type { CompileSection as Section } from '../../api/types';
import { closeUnclosedCodeFences } from '../../utils/markdownUtils';

interface Props {
  section: Section;
  content: string | null | undefined;
  headingComponents: Components;
  estimateBodyHeight: number;
}

export const CompileSection = memo(function CompileSection({ section, content, headingComponents, estimateBodyHeight }: Props) {
  const loaded = content !== undefined || section.chars === 0 || section.cycle;
  const markdown = [section.heading, loaded ? content || null : null, loaded ? section.unfurl_text || null : null].filter(Boolean).join('\n');
  return <>
    <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} components={headingComponents}>{closeUnclosedCodeFences(markdown)}</Markdown>
    {!loaded && <div className="bg-muted" aria-hidden="true" style={{ height: estimateBodyHeight }} />}
  </>;
});
