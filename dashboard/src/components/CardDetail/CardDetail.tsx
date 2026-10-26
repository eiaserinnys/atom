import { JevVerdict } from './JevVerdict';
import type { MotionNode } from '../SearchMotionView/types';
import { useState } from 'react';
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

export function CardDetail({ nodeId, verdict }: CardDetailProps) {
  const { t } = useTranslation();

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingContent, setEditingContent] = useState(false);
  const [contentDraft, setContentDraft] = useState('');
  const [editingJournalLimit, setEditingJournalLimit] = useState(false);
  const [journalLimitDraft, setJournalLimitDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const [editBaseVersion, setEditBaseVersion] = useState<number | null>(null);
  const [saveErrors, setSaveErrors] = useState({ title: null as string | null, content: null as string | null, journalLimit: null as string | null });

  const sample = verdict?.sample;

  const { data: node, isLoading, isError } = useQuery<TreeNodeData>({
    queryKey: nodeQueryKey(nodeId),
    queryFn: () => api.getNode(nodeId!),
    enabled: !!nodeId && !sample,
    retry: false,
  });

  const card = node?.card;

  const setSaveError = (field: 'title' | 'content' | 'journalLimit', message: string) => {
    setSaveErrors((current) => ({ ...current, [field]: message }));
  };
  const clearSaveError = (field: 'title' | 'content' | 'journalLimit') => {
    setSaveErrors((current) => ({ ...current, [field]: null }));
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
    saving,
    invalidateNode,
    saveTitle,
    saveContent,
    saveJournalLimit,
  } = useCardDetailSaves({
    nodeId,
    saveFailedLabel: t('card.save_failed'),
    onSaveError: setSaveError,
    onTitleSaved: (updatedCard) => {
      setEditingTitle(false);
      setEditBaseVersion(editingContent ? updatedCard.version : null);
    },
    onContentSaved: (updatedCard) => {
      setEditingContent(false);
      setEditBaseVersion(editingTitle ? updatedCard.version : null);
    },
    onJournalLimitSaved: () => setEditingJournalLimit(false),
    onJournalLimitIgnored: () => setEditingJournalLimit(false),
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
    setEditingTitle(false);
    setEditingContent(false);
    setEditingJournalLimit(false);
    setEditBaseVersion(null);
    setSaveErrors({ title: null, content: null, journalLimit: null });
    invalidateNode();
  };

  const startTitleEdit = () => {
    if (!card) return;
    setTitleDraft(card.title);
    clearSaveError('title');
    if (!editingContent) setEditBaseVersion(card.version);
    setEditingTitle(true);
  };

  const startContentEdit = () => {
    if (!card) return;
    setContentDraft(card.content ?? '');
    clearSaveError('content');
    if (!editingTitle) setEditBaseVersion(card.version);
    setEditingContent(true);
  };

  const startJournalLimitEdit = () => {
    if (!node) return;
    const current = node.journal_limit;
    setJournalLimitDraft(current !== null && current !== undefined ? String(current) : '');
    clearSaveError('journalLimit');
    setEditingJournalLimit(true);
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
        {!!card && editBaseVersion !== null && card.version !== editBaseVersion && (editingTitle || editingContent) && (
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
              setTitleDraft={setTitleDraft}
              onStartTitleEdit={startTitleEdit}
              onSaveTitle={() => { clearSaveError('title'); void saveTitle(card.id, titleDraft); }}
              onCancelTitle={() => { clearSaveError('title'); setEditingTitle(false); if (!editingContent) setEditBaseVersion(null); }}
              editingContent={editingContent}
              contentDraft={contentDraft}
              setContentDraft={setContentDraft}
              onStartContentEdit={startContentEdit}
              onSaveContent={() => { clearSaveError('content'); void saveContent(card.id, contentDraft); }}
              onCancelContent={() => { clearSaveError('content'); setEditingContent(false); if (!editingTitle) setEditBaseVersion(null); }}
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
              setJournalLimitDraft={setJournalLimitDraft}
              onStartJournalLimitEdit={startJournalLimitEdit}
              onSaveJournalLimit={() => { clearSaveError('journalLimit'); void saveJournalLimit(journalLimitDraft); }}
              onCancelJournalLimit={() => { clearSaveError('journalLimit'); setEditingJournalLimit(false); }}
            />
          </>
        )}
      </div>
    </div>
  );
}
