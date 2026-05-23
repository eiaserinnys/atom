import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type TreeNodeData } from '../../api/client';
import i18n from '../../i18n';
import { CardEditableFields } from './CardEditableFields';
import { CardMetadata } from './CardMetadata';
import { useCardDetailSaves } from './useCardDetailSaves';
import { nodeQueryKey } from '../../query/queryKeys';

interface CardDetailProps {
  nodeId: string | null;
}

export function CardDetail({ nodeId }: CardDetailProps) {
  const { t } = useTranslation();

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingContent, setEditingContent] = useState(false);
  const [contentDraft, setContentDraft] = useState('');
  const [editingJournalLimit, setEditingJournalLimit] = useState(false);
  const [journalLimitDraft, setJournalLimitDraft] = useState('');

  const isDirty = editingTitle || editingContent || editingJournalLimit;

  const { data: node, isLoading, isError } = useQuery<TreeNodeData>({
    queryKey: nodeQueryKey(nodeId),
    queryFn: () => api.getNode(nodeId!),
    enabled: !!nodeId,
    retry: false,
  });

  const card = node?.card;

  const {
    saving,
    invalidateNode,
    saveTitle,
    saveContent,
    saveJournalLimit,
  } = useCardDetailSaves({
    nodeId,
    saveFailedLabel: t('card.save_failed'),
    onTitleSaved: () => setEditingTitle(false),
    onContentSaved: () => setEditingContent(false),
    onJournalLimitSaved: () => setEditingJournalLimit(false),
    onJournalLimitIgnored: () => setEditingJournalLimit(false),
  });

  // 삭제된 카드 처리 — api.getNode가 404 시 throw하므로 isError로 감지
  if (isError && nodeId && !isLoading) {
    return (
      <div className="h-full flex flex-col bg-background">
        <div className="h-10 px-4 flex items-center text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground border-b border-border bg-card shrink-0">
          {t('card.header')}
        </div>
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          <div className="text-muted-foreground text-sm py-4">{t('card.deleted')}</div>
        </div>
      </div>
    );
  }

  const handleRefresh = () => {
    setEditingTitle(false);
    setEditingContent(false);
    setEditingJournalLimit(false);
    invalidateNode();
  };

  const startTitleEdit = () => {
    if (!card) return;
    setTitleDraft(card.title);
    setEditingTitle(true);
  };

  const startContentEdit = () => {
    if (!card) return;
    setContentDraft(card.content ?? '');
    setEditingContent(true);
  };

  const startJournalLimitEdit = () => {
    if (!node) return;
    const current = node.journal_limit;
    setJournalLimitDraft(current !== null && current !== undefined ? String(current) : '');
    setEditingJournalLimit(true);
  };

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="h-10 px-4 flex items-center text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground border-b border-border bg-card shrink-0">
        {t('card.header')}
      </div>
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {!nodeId && (
          <div className="text-muted-foreground text-sm">{t('card.no_selection')}</div>
        )}
        {isLoading && <div className="text-muted-foreground text-sm">{t('common.loading')}</div>}

        {/* Dirty State Guard — 편집 중 외부 변경 감지 배너 */}
        {isDirty && card && (
          <div className="flex items-center justify-between gap-2 bg-brand/8 border border-brand/25 rounded-md px-3 py-2 text-sm text-foreground shrink-0">
            <span className="flex-1">
              {t('card.unsaved_changes')}
            </span>
            <button
              className="bg-brand text-white border-none rounded px-2.5 py-0.5 text-[11px] cursor-pointer whitespace-nowrap hover:opacity-85"
              onClick={handleRefresh}
            >
              {t('card.refresh')}
            </button>
          </div>
        )}

        {node && card && !isLoading && (
          <>
            <CardEditableFields
              card={card}
              t={t}
              saving={saving}
              editingTitle={editingTitle}
              titleDraft={titleDraft}
              setTitleDraft={setTitleDraft}
              onStartTitleEdit={startTitleEdit}
              onSaveTitle={() => saveTitle(card.id, titleDraft)}
              onCancelTitle={() => setEditingTitle(false)}
              editingContent={editingContent}
              contentDraft={contentDraft}
              setContentDraft={setContentDraft}
              onStartContentEdit={startContentEdit}
              onSaveContent={() => saveContent(card.id, contentDraft)}
              onCancelContent={() => setEditingContent(false)}
            />
            <CardMetadata
              card={card}
              node={node}
              t={t}
              i18nLanguage={i18n.language}
              saving={saving}
              editingJournalLimit={editingJournalLimit}
              journalLimitDraft={journalLimitDraft}
              setJournalLimitDraft={setJournalLimitDraft}
              onStartJournalLimitEdit={startJournalLimitEdit}
              onSaveJournalLimit={() => saveJournalLimit(journalLimitDraft)}
              onCancelJournalLimit={() => setEditingJournalLimit(false)}
            />
          </>
        )}
      </div>
    </div>
  );
}
