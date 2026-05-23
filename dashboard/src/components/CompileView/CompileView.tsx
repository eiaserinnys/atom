import { useMemo, useState } from 'react';
import { closeUnclosedCodeFences } from '../../utils/markdownUtils';
import { parseCompileSections, type SectionMap } from '../../utils/parseCompileSections';
import { CompileContent } from './CompileContent';
import { CompileToc } from './CompileToc';
import { CompileToolbar } from './CompileToolbar';
import { useCompileDepth } from './useCompileDepth';
import { useCompileQueries } from './useCompileQueries';
import { useCompileToc } from './useCompileToc';
import { useEditableHeadingComponents } from './useEditableHeadingComponents';

interface CompileViewProps {
  nodeId: string | null;
}

export function CompileView({ nodeId }: CompileViewProps) {
  const [unfurlEnabled, setUnfurlEnabled] = useState(false);
  const { sliderValue, depth, depthLabel, handleSliderChange } = useCompileDepth();
  const { markdown, isLoading, error, unfurls } = useCompileQueries(nodeId, depth, unfurlEnabled);
  const processedMarkdown = useMemo(
    () => (markdown ? closeUnclosedCodeFences(markdown) : undefined),
    [markdown]
  );
  const {
    contentRef,
    scrollContainerRef,
    tocEntries,
    tocVisible,
    setTocVisible,
    activeId,
    scrollTo,
    minLevel,
  } = useCompileToc(markdown);

  // 마크다운에서 섹션→카드ID 매핑 파싱 (편집 버튼 활성화용)
  const sectionMap: SectionMap = useMemo(
    () => (markdown ? parseCompileSections(markdown) : new Map()),
    [markdown]
  );
  const headingComponents = useEditableHeadingComponents(nodeId, sectionMap);

  return (
    <div className="h-full flex flex-col bg-background border-r border-border">
      <CompileToolbar
        nodeId={nodeId}
        sliderValue={sliderValue}
        depthLabel={depthLabel}
        unfurlEnabled={unfurlEnabled}
        onSliderChange={handleSliderChange}
        onToggleUnfurl={() => setUnfurlEnabled((v) => !v)}
      />

      <div className="flex-1 flex overflow-hidden relative">
        <CompileToc
          tocEntries={tocEntries}
          tocVisible={tocVisible}
          activeId={activeId}
          minLevel={minLevel}
          onVisibleChange={setTocVisible}
          onScrollTo={scrollTo}
        />

        <div className="flex-1 overflow-y-auto" ref={scrollContainerRef}>
          <CompileContent
            contentRef={contentRef}
            nodeId={nodeId}
            isLoading={isLoading}
            error={error}
            markdown={markdown}
            processedMarkdown={processedMarkdown}
            headingComponents={headingComponents}
            unfurls={unfurls}
          />
        </div>
      </div>
    </div>
  );
}
