import type { KeyboardEvent } from 'react';
import type { TFunction } from 'i18next';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { Pencil } from 'lucide-react';
import type { CardData } from '../../api/client';
import { Spinner } from '../Spinner';

interface CardEditableFieldsProps {
  card: CardData;
  t: TFunction;
  saving: boolean;
  titleSaveError: string | null;
  contentSaveError: string | null;
  editingTitle: boolean;
  titleDraft: string;
  setTitleDraft: (draft: string) => void;
  onStartTitleEdit: () => void;
  onSaveTitle: () => void;
  onCancelTitle: () => void;
  editingContent: boolean;
  contentDraft: string;
  setContentDraft: (draft: string) => void;
  onStartContentEdit: () => void;
  onSaveContent: () => void;
  onCancelContent: () => void;
}

function startEditOnKeyboard(event: KeyboardEvent<HTMLDivElement>, startEdit: () => void) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    startEdit();
  }
}

export function CardEditableFields({
  card,
  t,
  saving,
  titleSaveError,
  contentSaveError,
  editingTitle,
  titleDraft,
  setTitleDraft,
  onStartTitleEdit,
  onSaveTitle,
  onCancelTitle,
  editingContent,
  contentDraft,
  setContentDraft,
  onStartContentEdit,
  onSaveContent,
  onCancelContent,
}: CardEditableFieldsProps) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        {editingTitle ? (
          <div className="-mx-2">
            <input
              className="w-full px-2 py-1.5 border border-border bg-input text-foreground font-sans text-base font-semibold focus:outline-none"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSaveTitle();
                if (e.key === 'Escape') onCancelTitle();
              }}
              autoFocus
            />
            <div className="flex gap-1.5 items-center mt-1.5">
              <button
                className="bg-brand text-primary-foreground border-none rounded-none px-3 py-1 text-[13px] cursor-pointer font-sans disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                onClick={onSaveTitle}
                disabled={saving}
              >
                {saving && <Spinner size="sm" />}{t('common.save')}
              </button>
              <button
                className="bg-transparent text-muted-foreground border border-border rounded-none px-2.5 py-1 text-[13px] cursor-pointer font-sans hover:bg-muted"
                onClick={onCancelTitle}
              >
                {t('common.cancel')}
              </button>
            </div>
            {titleSaveError && <p role="alert" className="text-[13px] text-node-error">{titleSaveError}</p>}
          </div>
        ) : (
          <div
            className="group text-base font-semibold text-foreground -mx-2 px-2 py-1.5 border border-transparent cursor-pointer transition-colors hover:border-border hover:bg-muted"
            onClick={onStartTitleEdit}
            onKeyDown={(event) => startEditOnKeyboard(event, onStartTitleEdit)}
            role="button"
            tabIndex={0}
            aria-label={t('card.edit_title')}
            title={t('card.click_to_edit')}
          >
            {card.title}
            <Pencil className="w-3.5 h-3.5 inline-block align-text-bottom text-muted-foreground ml-1.5 opacity-0 group-hover:opacity-100 transition-opacity" strokeWidth={1.75} />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        {editingContent ? (
          <div className="-mx-2">
            <textarea
              className="w-full px-2 py-1.5 border border-border bg-input text-foreground font-sans focus:outline-none text-base leading-[1.7] resize-none"
              value={contentDraft}
              onChange={(e) => setContentDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') onCancelContent(); }}
              rows={8}
              autoFocus
            />
            <div className="flex gap-1.5 items-center mt-1.5">
              <button
                className="bg-brand text-primary-foreground border-none rounded-none px-3 py-1 text-[13px] cursor-pointer font-sans disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                onClick={onSaveContent}
                disabled={saving}
              >
                {saving && <Spinner size="sm" />}{t('common.save')}
              </button>
              <button
                className="bg-transparent text-muted-foreground border border-border rounded-none px-2.5 py-1 text-[13px] cursor-pointer font-sans hover:bg-muted"
                onClick={onCancelContent}
              >
                {t('common.cancel')}
              </button>
            </div>
            {contentSaveError && <p role="alert" className="text-[13px] text-node-error">{contentSaveError}</p>}
          </div>
        ) : (
          <div
            className="text-base text-foreground -mx-2 px-2 py-1.5 border border-transparent cursor-pointer transition-colors hover:border-border hover:bg-muted"
            onClick={onStartContentEdit}
            onKeyDown={(event) => startEditOnKeyboard(event, onStartContentEdit)}
            role="button"
            tabIndex={0}
            aria-label={t('card.edit_content')}
            title={t('card.click_to_edit')}
          >
            {card.content ? (
              <div className="markdown-content">
                <Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>{card.content}</Markdown>
              </div>
            ) : (
              <span className="text-muted-foreground">{t('card.empty_content')}</span>
            )}
          </div>
        )}
      </div>
    </>
  );
}
