import { useCallback, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { VersionConflictError } from '../../api/request';
import { standardCompileNodeQueryKey } from '../../query/queryKeys';
import { closeUnclosedCodeFences } from '../../utils/markdownUtils';
import { parseCompileSections, type SectionMap } from '../../utils/parseCompileSections';
import { CardFormModal } from '../CardFormModal/CardFormModal';
import { CompileContent } from './CompileContent';
import { CompileToc } from './CompileToc';
import { CompileToolbar } from './CompileToolbar';
import { useCompileDepth } from './useCompileDepth';
import { useCompileQueries } from './useCompileQueries';
import { useCompileToc } from './useCompileToc';
import { useEditableHeadingComponents } from './useEditableHeadingComponents';

interface EditingCard {
  cardId: string;
  title: string;
  content: string;
  version: number;
  sessionId: number;
}

interface CompileViewProps {
  nodeId: string | null;
  headerTabs?: React.ReactNode;
}

export function CompileView({ nodeId, headerTabs }: CompileViewProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [unfurlEnabled, setUnfurlEnabled] = useState(false);
  const [editing, setEditing] = useState<EditingCard | null>(null);
  const editLoadSequence = useRef(0);
  const { sliderValue, depth, depthLabel, selectDepth } = useCompileDepth();
  const { markdown, isLoading, error, unfurls } = useCompileQueries(nodeId, depth, unfurlEnabled);
  const {
    mutate: saveEditedCard,
    isPending: isEditPending,
    error: editError,
    reset: resetEditMutation,
  } = useMutation({
    mutationFn: (vars: EditingCard) =>
      api.updateCard(vars.cardId, { title: vars.title, content: vars.content, expected_version: vars.version }),
    onSuccess: (_card, vars) => {
      queryClient.invalidateQueries({ queryKey: standardCompileNodeQueryKey(nodeId) });
      setEditing(current => current?.sessionId === vars.sessionId ? null : current);
    },
  });
  const openCardForEdit = useCallback(async (cardId: string) => {
    const requestSequence = ++editLoadSequence.current;
    resetEditMutation();
    const card = await api.getCard(cardId);
    if (requestSequence !== editLoadSequence.current) return;
    setEditing({ cardId, title: card.title, content: card.content ?? '', version: card.version, sessionId: requestSequence });
  }, [resetEditMutation]);
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
  const headingComponents = useEditableHeadingComponents(nodeId, sectionMap, openCardForEdit);

  return (
    <div className="h-full flex flex-col bg-background">
      <CompileToolbar
        headerTabs={headerTabs}
        nodeId={nodeId}
        sliderValue={sliderValue}
        depthLabel={depthLabel}
        unfurlEnabled={unfurlEnabled}
        selectDepth={selectDepth}
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
            isLoading={isLoading}
            error={error}
            markdown={markdown}
            processedMarkdown={processedMarkdown}
            headingComponents={headingComponents}
            unfurls={unfurls}
          />
        </div>
      </div>

      {editing && (
        <CardFormModal
          mode="edit"
          initialTitle={editing.title}
          initialContent={editing.content}
          onConfirm={(title, content) => saveEditedCard({ ...editing, title, content })}
          onClose={() => setEditing(null)}
          isLoading={isEditPending}
          errorMessage={editError instanceof VersionConflictError ? t('card.unsaved_changes') : undefined}
        />
      )}
    </div>
  );
}
