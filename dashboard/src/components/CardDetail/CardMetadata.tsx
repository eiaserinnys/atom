import type { TFunction } from 'i18next';
import { Pencil } from 'lucide-react';
import type { CardData, TreeNodeData } from '../../api/client';
import { Spinner } from '../Spinner';
import { formatJournalLimitLabel, isHttpSourceRef } from './cardDetailLogic';

interface CardMetadataProps {
  card: CardData;
  node: TreeNodeData;
  t: TFunction;
  i18nLanguage: string;
  saving: boolean;
  journalLimitSaveError: string | null;
  editingJournalLimit: boolean;
  journalLimitDraft: string;
  setJournalLimitDraft: (draft: string) => void;
  onStartJournalLimitEdit: () => void;
  onSaveJournalLimit: () => void;
  onCancelJournalLimit: () => void;
}

export function CardMetadata({
  card,
  node,
  t,
  i18nLanguage,
  saving,
  journalLimitSaveError,
  editingJournalLimit,
  journalLimitDraft,
  setJournalLimitDraft,
  onStartJournalLimitEdit,
  onSaveJournalLimit,
  onCancelJournalLimit,
}: CardMetadataProps) {
  const journalLimitLabel = formatJournalLimitLabel(node.journal_limit, t);

  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1.5 items-baseline pt-2 border-t border-border">
      {(card.source_type || card.source_ref) && <>
        <span className="text-[13px] text-muted-foreground">{t('card.source')}</span>
        <span className="text-[13px] text-foreground break-all">
          {card.source_type}
          {card.source_type && card.source_ref && ' '}
          {card.source_ref && (isHttpSourceRef(card.source_ref) ? (
            <a href={card.source_ref} target="_blank" rel="noopener noreferrer" className="text-primary underline break-all">
              {card.source_ref}
            </a>
          ) : card.source_ref)}
        </span>
      </>}
      {card.tags.length > 0 && <>
        <span className="text-[13px] text-muted-foreground">{t('card.tags_label')}</span>
        <div className="flex flex-wrap gap-1">
          {card.tags.map((tag) => (
            <span key={tag} className="text-[13px] bg-muted border border-border rounded-none px-1.5 py-px text-foreground">{tag}</span>
          ))}
        </div>
      </>}
      {card.references.length > 0 && <>
        <span className="text-[13px] text-muted-foreground">{t('card.refs_label')}</span>
        <span className="text-[13px] text-foreground">{card.references.join(', ')}</span>
      </>}
      <span className="text-[13px] text-muted-foreground">{t('card.journal_limit_label')}</span>
      {editingJournalLimit ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1.5 items-center">
            <input
              type="text"
              inputMode="numeric"
              className="w-20 bg-input border border-border rounded-none px-2 py-1 text-foreground text-[13px] font-sans focus:outline-none focus:border-brand"
              value={journalLimitDraft}
              placeholder={t('card.journal_limit_all')}
              onChange={(e) => setJournalLimitDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onSaveJournalLimit(); if (e.key === 'Escape') onCancelJournalLimit(); }}
              autoFocus
            />
            <button
              className="bg-brand text-primary-foreground border-none rounded-none px-2.5 py-0.5 text-[13px] cursor-pointer font-sans disabled:opacity-50 inline-flex items-center gap-1.5"
              onClick={onSaveJournalLimit}
              disabled={saving}
            >
              {saving && <Spinner size="sm" />}{t('common.save')}
            </button>
            <button
              className="bg-transparent text-muted-foreground border border-border rounded-none px-2 py-0.5 text-[13px] cursor-pointer font-sans hover:bg-muted"
              onClick={onCancelJournalLimit}
            >
              {t('common.cancel')}
            </button>
          </div>
          {journalLimitSaveError && <p role="alert" className="text-[13px] text-node-error">{journalLimitSaveError}</p>}
        </div>
      ) : (
        <span
          className="group text-[13px] text-foreground cursor-pointer rounded-none px-1 py-0.5 border border-transparent hover:border-border hover:bg-muted"
          onClick={onStartJournalLimitEdit}
          title={t('card.click_to_edit')}
        >
          {journalLimitLabel}
          <Pencil className="w-3.5 h-3.5 inline-block align-text-bottom text-muted-foreground ml-1 opacity-0 group-hover:opacity-100 transition-opacity" strokeWidth={1.75} />
        </span>
      )}
      <span className="text-[13px] text-muted-foreground">{t('card.version_label')}</span>
      <span className="text-[13px] text-foreground">{card.version}</span>
      <span className="text-[13px] text-muted-foreground">{t('card.updated_at_label')}</span>
      <span className="text-[13px] text-foreground">{new Date(card.updated_at).toLocaleString(i18nLanguage)}</span>
      {card.created_by && <>
        <span className="text-[13px] text-muted-foreground">{t('card.created_by_label')}</span>
        <span className="text-[13px] text-foreground">{card.created_by}</span>
      </>}
      {card.updated_by && card.updated_by !== card.created_by && <>
        <span className="text-[13px] text-muted-foreground">{t('card.updated_by_label')}</span>
        <span className="text-[13px] text-foreground">{card.updated_by}</span>
      </>}
    </div>
  );
}
