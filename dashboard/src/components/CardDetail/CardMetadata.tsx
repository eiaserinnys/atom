import type { TFunction } from 'i18next';
import type { CardData, TreeNodeData } from '../../api/client';
import { formatJournalLimitLabel, isHttpSourceRef } from './cardDetailLogic';

interface CardMetadataProps {
  card: CardData;
  node: TreeNodeData;
  t: TFunction;
  i18nLanguage: string;
  saving: boolean;
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
  editingJournalLimit,
  journalLimitDraft,
  setJournalLimitDraft,
  onStartJournalLimitEdit,
  onSaveJournalLimit,
  onCancelJournalLimit,
}: CardMetadataProps) {
  const journalLimitLabel = formatJournalLimitLabel(node.journal_limit);

  return (
    <div className="flex flex-col gap-1.5 pt-2 border-t border-border">
      <div className="flex gap-2.5 items-baseline">
        <span className="text-xs text-muted-foreground w-[70px] shrink-0">{t('card.type_label')}</span>
        <span className="text-[13px] text-muted-foreground">
          {card.card_type}
        </span>
      </div>
      {node.is_symlink && (
        <div className="flex gap-2.5 items-baseline">
          <span className="text-xs text-muted-foreground w-[70px] shrink-0">{t('card.symlink_label')}</span>
          <span className="text-[13px] text-foreground">↗ yes</span>
        </div>
      )}
      {card.source_type && (
        <div className="flex gap-2.5 items-baseline">
          <span className="text-xs text-muted-foreground w-[70px] shrink-0">{t('card.source_type_label')}</span>
          <span className="text-[13px] text-foreground">{card.source_type}</span>
        </div>
      )}
      {card.source_ref && (
        <div className="flex gap-2.5 items-baseline">
          <span className="text-xs text-muted-foreground w-[70px] shrink-0">{t('card.source_ref_label')}</span>
          {isHttpSourceRef(card.source_ref) ? (
            <a
              href={card.source_ref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] text-primary underline break-all"
            >
              {card.source_ref}
            </a>
          ) : (
            <span className="text-[13px] text-foreground break-all">{card.source_ref}</span>
          )}
        </div>
      )}
      {card.tags.length > 0 && (
        <div className="flex gap-2.5 items-baseline">
          <span className="text-xs text-muted-foreground w-[70px] shrink-0">{t('card.tags_label')}</span>
          <div className="flex flex-wrap gap-1">
            {card.tags.map((tag) => (
              <span key={tag} className="text-xs bg-muted border border-border rounded px-1.5 py-px text-foreground">{tag}</span>
            ))}
          </div>
        </div>
      )}
      {card.references.length > 0 && (
        <div className="flex gap-2.5 items-baseline">
          <span className="text-xs text-muted-foreground w-[70px] shrink-0">{t('card.refs_label')}</span>
          <span className="text-[13px] text-foreground">{card.references.join(', ')}</span>
        </div>
      )}
      <div className="flex gap-2.5 items-baseline">
        <span className="text-xs text-muted-foreground w-[70px] shrink-0">journal limit</span>
        {editingJournalLimit ? (
          <div className="flex gap-1.5 items-center flex-1">
            <input
              type="number"
              min="0"
              className="w-20 bg-white dark:bg-[#1c1c1e] border border-[#d2d2d7] dark:border-[#333336] rounded-[6px] px-2 py-1 text-foreground text-[13px] font-sans focus:outline-none focus:border-brand"
              value={journalLimitDraft}
              placeholder="빈값=무제한"
              onChange={(e) => setJournalLimitDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onSaveJournalLimit(); if (e.key === 'Escape') onCancelJournalLimit(); }}
              autoFocus
            />
            <button
              className="bg-brand text-white border-none rounded px-2.5 py-0.5 text-[11px] cursor-pointer font-sans disabled:opacity-50"
              onClick={onSaveJournalLimit}
              disabled={saving}
            >
              {saving ? '...' : t('common.save')}
            </button>
            <button
              className="bg-transparent text-muted-foreground border border-border rounded px-2 py-0.5 text-[11px] cursor-pointer font-sans hover:bg-muted"
              onClick={onCancelJournalLimit}
            >
              {t('common.cancel')}
            </button>
          </div>
        ) : (
          <span
            className="group text-[13px] text-foreground cursor-pointer rounded px-1 py-0.5 border border-transparent hover:border-border hover:bg-muted"
            onClick={onStartJournalLimitEdit}
            title={t('card.click_to_edit')}
          >
            {journalLimitLabel ?? <span className="text-muted-foreground">—</span>}
            <span className="text-[10px] text-muted-foreground ml-1 opacity-0 group-hover:opacity-100 transition-opacity">✎</span>
          </span>
        )}
      </div>
      <div className="flex gap-2.5 items-baseline">
        <span className="text-xs text-muted-foreground w-[70px] shrink-0">staleness</span>
        <span className="text-[13px] text-foreground">{card.staleness}</span>
      </div>
      <div className="flex gap-2.5 items-baseline">
        <span className="text-xs text-muted-foreground w-[70px] shrink-0">{t('card.version_label')}</span>
        <span className="text-[13px] text-foreground">{card.version}</span>
      </div>
      <div className="flex gap-2.5 items-baseline">
        <span className="text-xs text-muted-foreground w-[70px] shrink-0">{t('card.updated_at_label')}</span>
        <span className="text-[13px] text-foreground">
          {new Date(card.updated_at).toLocaleString(i18nLanguage)}
        </span>
      </div>
      {card.created_by && (
        <div className="flex gap-2.5 items-baseline">
          <span className="text-xs text-muted-foreground w-[70px] shrink-0">{t('card.created_by_label')}</span>
          <span className="text-[13px] text-foreground">{card.created_by}</span>
        </div>
      )}
      {card.updated_by && card.updated_by !== card.created_by && (
        <div className="flex gap-2.5 items-baseline">
          <span className="text-xs text-muted-foreground w-[70px] shrink-0">{t('card.updated_by_label')}</span>
          <span className="text-[13px] text-foreground">{card.updated_by}</span>
        </div>
      )}
    </div>
  );
}
