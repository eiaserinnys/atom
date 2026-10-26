import { JevVerdict } from './JevVerdict';
import type { MotionNode } from '../SearchMotionView/types';
import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Check, Copy, FileText, Folder } from 'lucide-react';
import { api, type TreeNodeData } from '../../api/client';
import i18n from '../../i18n';
import { PanelState } from '../PanelState';
import { Spinner } from '../Spinner';
import { CardEditableFields } from './CardEditableFields';
import { CardMetadata } from './CardMetadata';
import { useCardDetailSaves } from './useCardDetailSaves';
import { nodeQueryKey } from '../../query/queryKeys';

interface CardDetailProps {
  nodeId: string | null;
  verdict?: MotionNode | null;
}

interface EditDraft {
  editingTitle: boolean;
  titleDraft: string;
  editingContent: boolean;
  contentDraft: string;
  editingJournalLimit: boolean;
  journalLimitDraft: string;
  editBaseVersion: number | null;
  versionConflict: boolean;
  saving: boolean;
  saveErrors: { title: string | null; content: string | null; journalLimit: string | null };
}

const emptyDraft: EditDraft = {
  editingTitle: false, titleDraft: '', editingContent: false, contentDraft: '',
  editingJournalLimit: false, journalLimitDraft: '', editBaseVersion: null,
  versionConflict: false, saving: false,
  saveErrors: { title: null, content: null, journalLimit: null },
};

export function CardDetail({ nodeId, verdict }: CardDetailProps) {
  const { t } = useTranslation();

  const [drafts, setDrafts] = useState<Record<string, EditDraft>>({});
  const [copied, setCopied] = useState(false);

  const sample = verdict?.sample;

  const { data: node, isLoading, isError } = useQuery<TreeNodeData>({
    queryKey: nodeQueryKey(nodeId),
    queryFn: () => api.getNode(nodeId!),
    enabled: !!nodeId && !sample,
    retry: false,
  });

  const card = node?.card;
  const cardId = card?.id;
  const draft = (cardId && drafts[cardId]) || emptyDraft;
  const { editingTitle, titleDraft, editingContent, contentDraft, editingJournalLimit,
    journalLimitDraft, editBaseVersion, versionConflict, saving, saveErrors } = draft;

  // Each callback captures its card id, including callbacks finishing after a selection change.
  const updateDraft = useCallback((update: (current: EditDraft) => EditDraft) => {
    if (!cardId) return;
    setDrafts(current => ({ ...current, [cardId]: update(current[cardId] ?? emptyDraft) }));
  }, [cardId]);

  const setSaveError = (field: 'title' | 'content' | 'journalLimit', message: string) => {
    updateDraft(current => ({ ...current, saveErrors: { ...current.saveErrors, [field]: message } }));
  };
  const clearSaveError = (field: 'title' | 'content' | 'journalLimit') => {
    updateDraft(current => ({ ...current, saveErrors: { ...current.saveErrors, [field]: null } }));
  };

  const copyId = async () => {
    if (!nodeId) return;
    try {
      await navigator.clipboard.writeText(nodeId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be unavailable in insecure contexts.
    }
  };

  const {
    invalidateNode,
    saveTitle,
    saveContent,
    saveJournalLimit,
  } = useCardDetailSaves({
    nodeId,
    editBaseVersion,
    onSavingChange: (saving) => updateDraft(current => ({ ...current, saving })),
    onVersionConflict: (currentVersion) => updateDraft(current => ({ ...current, editBaseVersion: currentVersion, versionConflict: true })),
    saveFailedLabel: t('card.save_failed'),
    onSaveError: setSaveError,
    onTitleSaved: (updatedCard) => {
      updateDraft(current => ({
        ...current, editingTitle: false, versionConflict: false,
        editBaseVersion: !current.editingContent ? null
          : current.editBaseVersion !== null && updatedCard.version === current.editBaseVersion + 1 ? updatedCard.version : current.editBaseVersion,
      }));
    },
    onContentSaved: (updatedCard) => {
      updateDraft(current => ({
        ...current, editingContent: false, versionConflict: false,
        editBaseVersion: !current.editingTitle ? null
          : current.editBaseVersion !== null && updatedCard.version === current.editBaseVersion + 1 ? updatedCard.version : current.editBaseVersion,
      }));
    },
    onJournalLimitSaved: () => updateDraft(current => ({ ...current, editingJournalLimit: false })),
    onJournalLimitIgnored: () => updateDraft(current => ({ ...current, editingJournalLimit: false })),
  });

  // 삭제된 카드 처리 — api.getNode가 404 시 throw하므로 isError로 감지
  if (isError && nodeId && !isLoading && !sample) {
    return (
      <div className="h-full flex flex-col bg-background">
        <div className="h-10 max-md:h-12 px-4 flex items-center gap-1.5 border-b border-border bg-card shrink-0" />
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          <PanelState><p className="text-sm text-muted-foreground">{t('card.deleted')}</p></PanelState>
        </div>
      </div>
    );
  }

  const handleRefresh = () => {
    updateDraft(() => emptyDraft);
    invalidateNode();
  };

  const startTitleEdit = () => {
    if (!card) return;
    clearSaveError('title');
    updateDraft(current => ({ ...current, titleDraft: card.title, editingTitle: true,
      editBaseVersion: current.editingContent ? current.editBaseVersion : card.version,
      versionConflict: current.editingContent && current.versionConflict }));
  };

  const startContentEdit = () => {
    if (!card) return;
    clearSaveError('content');
    updateDraft(current => ({ ...current, contentDraft: card.content ?? '', editingContent: true,
      editBaseVersion: current.editingTitle ? current.editBaseVersion : card.version,
      versionConflict: current.editingTitle && current.versionConflict }));
  };

  const startJournalLimitEdit = () => {
    if (!node) return;
    clearSaveError('journalLimit');
    updateDraft(current => ({ ...current, editingJournalLimit: true, journalLimitDraft: node.journal_limit != null ? String(node.journal_limit) : '' }));
  };

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="h-10 max-md:h-12 px-4 flex items-center gap-1.5 border-b border-border bg-card shrink-0">
        {node && card && <>
          {card.card_type === 'structure'
            ? <Folder className="w-3.5 h-3.5 text-[var(--blue)] shrink-0" strokeWidth={1.75} aria-hidden="true" />
            : <FileText className="w-3.5 h-3.5 text-brand shrink-0" strokeWidth={1.75} aria-hidden="true" />}
          <span className="text-[13px] font-semibold text-muted-foreground">{t(card.card_type === 'structure' ? 'searchbar.type_structure' : 'searchbar.type_knowledge')}</span>
          {node.is_symlink && <span className="text-[13px] text-muted-foreground" title={node.canonical_path} aria-label={t('card.symlink_label')}>↗</span>}
          <button type="button" onClick={copyId} className="ml-auto -mr-2 w-8 h-8 inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" aria-label={copied ? t('common.copied') : t('compile.copy_id')} title={copied ? t('common.copied') : t('compile.copy_id')}>
            {copied ? <Check className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> : <Copy className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />}
          </button>
        </>}
      </div>
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {verdict && <JevVerdict verdict={verdict} />}
        {sample && <article className="space-y-3"><h2 className="text-base font-semibold">{verdict.title}</h2><p className="text-[13px] text-muted-foreground">{verdict.path.join(' › ')}</p><p className="text-sm whitespace-pre-wrap">{verdict.summary || verdict.sentText}</p></article>}
        {isLoading && <PanelState><Spinner label={t('common.loading')} /></PanelState>}

        {/* Dirty State Guard — 편집 중 외부 변경 감지 배너 */}
        {!saving && !!card && editBaseVersion !== null && (versionConflict || card.version > editBaseVersion) && (editingTitle || editingContent) && (
          <div className="flex items-center justify-between gap-2 bg-brand/8 border border-brand/25 rounded-none px-3 py-2 text-sm text-foreground shrink-0">
            <span className="flex-1">
              {t('card.unsaved_changes')}
            </span>
            <button
              className="bg-brand text-primary-foreground border-none rounded-none px-2.5 py-0.5 text-[13px] cursor-pointer whitespace-nowrap hover:opacity-85"
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
              titleSaveError={saveErrors.title}
              contentSaveError={saveErrors.content}
              editingTitle={editingTitle}
              titleDraft={titleDraft}
              setTitleDraft={titleDraft => updateDraft(current => ({ ...current, titleDraft }))}
              onStartTitleEdit={startTitleEdit}
              onSaveTitle={() => { clearSaveError('title'); void saveTitle(card.id, titleDraft); }}
              onCancelTitle={() => { clearSaveError('title'); updateDraft(current => ({ ...current, editingTitle: false, editBaseVersion: current.editingContent ? current.editBaseVersion : null, versionConflict: current.editingContent && current.versionConflict })); }}
              editingContent={editingContent}
              contentDraft={contentDraft}
              setContentDraft={contentDraft => updateDraft(current => ({ ...current, contentDraft }))}
              onStartContentEdit={startContentEdit}
              onSaveContent={() => { clearSaveError('content'); void saveContent(card.id, contentDraft); }}
              onCancelContent={() => { clearSaveError('content'); updateDraft(current => ({ ...current, editingContent: false, editBaseVersion: current.editingTitle ? current.editBaseVersion : null, versionConflict: current.editingTitle && current.versionConflict })); }}
            />
            <CardMetadata
              card={card}
              node={node}
              t={t}
              i18nLanguage={i18n.language}
              saving={saving}
              journalLimitSaveError={saveErrors.journalLimit}
              editingJournalLimit={editingJournalLimit}
              journalLimitDraft={journalLimitDraft}
              setJournalLimitDraft={journalLimitDraft => updateDraft(current => ({ ...current, journalLimitDraft }))}
              onStartJournalLimitEdit={startJournalLimitEdit}
              onSaveJournalLimit={() => { clearSaveError('journalLimit'); void saveJournalLimit(journalLimitDraft); }}
              onCancelJournalLimit={() => { clearSaveError('journalLimit'); updateDraft(current => ({ ...current, editingJournalLimit: false })); }}
            />
          </>
        )}
      </div>
    </div>
  );
}
