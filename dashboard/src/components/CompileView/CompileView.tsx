import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { VersionConflictError } from '../../api/request';
import { invalidateSelectedCompileQueries } from '../../query/invalidation';
import { CardFormModal } from '../CardFormModal/CardFormModal';
import { CompileContent } from './CompileContent';
import { CompileFindBar } from './CompileFindBar';
import { CompileToc } from './CompileToc';
import { CompileToolbar } from './CompileToolbar';
import type { CompileListHandle } from './CompileVirtualList';
import type { SectionMap } from './EditableHeading';
import { useCompileDepth } from './useCompileDepth';
import { useCompileQueries } from './useCompileQueries';
import { useCompileFind } from './useCompileFind';
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
  const [findOpen, setFindOpen] = useState(false);
  const [editing, setEditing] = useState<EditingCard | null>(null);
  const editLoadSequence = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<CompileListHandle>(null);
  const { sliderValue, depth, depthLabel, selectDepth } = useCompileDepth();
  const { sections, isLoading, error, unfurls } = useCompileQueries(nodeId, depth, unfurlEnabled);
  const find = useCompileFind(nodeId, depth, findOpen, scrollRef, listRef);
  const changeFindQuery = find.changeQuery;
  const {
    mutate: saveEditedCard,
    isPending: isEditPending,
    error: editError,
    reset: resetEditMutation,
  } = useMutation({
    mutationFn: (vars: EditingCard) =>
      api.updateCard(vars.cardId, { title: vars.title, content: vars.content, expected_version: vars.version }),
    onSuccess: (_card, vars) => {
      invalidateSelectedCompileQueries(queryClient, nodeId);
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
  const sectionMap: SectionMap = useMemo(
    () => new Map((sections ?? []).map(section => [section.node_id, { nodeId: section.node_id, cardId: section.card_id }])),
    [sections]
  );
  const headingComponents = useEditableHeadingComponents(nodeId, sectionMap, openCardForEdit);
  const openFind = useCallback(() => {
    setFindOpen(true);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-compile-find-input]')?.focus());
  }, []);
  const closeFind = useCallback(() => {
    setFindOpen(false);
    changeFindQuery('');
    scrollRef.current?.focus();
  }, [changeFindQuery]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const scroll = scrollRef.current;
      const target = event.target as HTMLElement | null;
      if ((!event.ctrlKey && !event.metaKey) || event.key.toLowerCase() !== 'f' || !nodeId || editing || !scroll || scroll.closest('[hidden]') || !scroll.getClientRects().length) return;
      if (target?.matches('input, textarea, select') || target?.isContentEditable) return;
      if (document.querySelector('.fixed.inset-0.z-50')) return;
      event.preventDefault();
      openFind();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [editing, nodeId, openFind]);

  return (
    <div className="h-full flex flex-col bg-background">
      <CompileToolbar
        headerTabs={headerTabs}
        nodeId={nodeId}
        sliderValue={sliderValue}
        depth={depth}
        depthLabel={depthLabel}
        unfurlEnabled={unfurlEnabled}
        selectDepth={selectDepth}
        onToggleUnfurl={() => setUnfurlEnabled((v) => !v)}
        onOpenFind={openFind}
      />
      {findOpen && nodeId && <CompileFindBar query={find.query} current={find.current} total={find.total} onChange={find.changeQuery} onNavigate={find.navigate} onClose={closeFind} />}

      <div className="flex-1 flex overflow-hidden relative">
        {sections && <CompileToc sections={sections} scrollRef={scrollRef} listRef={listRef} />}

        <div className="flex-1 overflow-y-auto focus:outline-none" ref={scrollRef} data-compile-scroll tabIndex={-1}>
          <CompileContent
            scrollRef={scrollRef}
            listRef={listRef}
            isLoading={isLoading}
            error={error}
            sections={sections}
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
