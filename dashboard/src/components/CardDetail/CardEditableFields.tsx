import type { TFunction } from 'i18next';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import type { CardData } from '../../api/client';

interface CardEditableFieldsProps {
  card: CardData;
  t: TFunction;
  saving: boolean;
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

export function CardEditableFields({
  card,
  t,
  saving,
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
        <div className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">{t('card.title_label')}</div>
        {editingTitle ? (
          <div className="flex gap-1.5 items-center">
            <input
              className="flex-1 bg-white dark:bg-[#1c1c1e] border border-[#d2d2d7] dark:border-[#333336] rounded-[8px] px-[14px] py-[10px] text-foreground text-base font-sans focus:outline-none focus:border-brand focus:shadow-focus-ring transition-shadow"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSaveTitle()}
              autoFocus
            />
            <button
              className="bg-brand text-white border-none rounded px-3 py-1 text-[13px] cursor-pointer font-sans disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={onSaveTitle}
              disabled={saving}
            >
              {saving ? '...' : t('common.save')}
            </button>
            <button
              className="bg-transparent text-muted-foreground border border-border rounded px-2.5 py-1 text-[13px] cursor-pointer font-sans hover:bg-muted"
              onClick={onCancelTitle}
            >
              {t('common.cancel')}
            </button>
          </div>
        ) : (
          <div
            className="group text-base text-foreground cursor-pointer rounded px-2 py-1.5 border border-transparent relative transition-colors hover:border-border hover:bg-muted"
            onClick={onStartTitleEdit}
            title={t('card.click_to_edit')}
          >
            {card.title}
            <span className="text-[11px] text-muted-foreground ml-1.5 opacity-0 group-hover:opacity-100 transition-opacity">✎</span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">{t('card.content_label')}</div>
        {editingContent ? (
          <div className="flex flex-col gap-1.5">
            <textarea
              className="w-full bg-white dark:bg-[#1c1c1e] border border-[#d2d2d7] dark:border-[#333336] rounded-[8px] px-[14px] py-[10px] text-foreground text-[15px] resize-y font-sans leading-[1.6] focus:outline-none focus:border-brand focus:shadow-focus-ring transition-shadow"
              value={contentDraft}
              onChange={(e) => setContentDraft(e.target.value)}
              rows={8}
              autoFocus
            />
            <div className="flex gap-1.5 items-center">
              <button
                className="bg-brand text-white border-none rounded px-3 py-1 text-[13px] cursor-pointer font-sans disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={onSaveContent}
                disabled={saving}
              >
                {saving ? '...' : t('common.save')}
              </button>
              <button
                className="bg-transparent text-muted-foreground border border-border rounded px-2.5 py-1 text-[13px] cursor-pointer font-sans hover:bg-muted"
                onClick={onCancelContent}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div
            className="group text-base text-foreground cursor-pointer rounded px-2 py-1.5 border border-transparent relative transition-colors hover:border-border hover:bg-muted"
            onClick={onStartContentEdit}
            title={t('card.click_to_edit')}
          >
            {card.content ? (
              <div className="markdown-content">
                <Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>{card.content}</Markdown>
              </div>
            ) : (
              <span className="text-muted-foreground text-sm">{t('card.empty_content')}</span>
            )}
            <span className="text-[11px] text-muted-foreground ml-1.5 opacity-0 group-hover:opacity-100 transition-opacity">✎</span>
          </div>
        )}
      </div>
    </>
  );
}
