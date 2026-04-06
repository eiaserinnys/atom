import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface CardFormModalProps {
  mode: 'create' | 'edit';
  cardType?: 'structure' | 'knowledge';
  initialTitle?: string;
  initialContent?: string;
  onConfirm: (title: string, content: string) => void;
  onClose: () => void;
  isLoading?: boolean;
}

export function CardFormModal({
  mode,
  cardType,
  initialTitle = '',
  initialContent = '',
  onConfirm,
  onClose,
  isLoading = false,
}: CardFormModalProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const heading =
    mode === 'create'
      ? cardType === 'structure'
        ? t('cardform.new_structure')
        : t('cardform.new_knowledge')
      : t('cardform.edit');

  function handleConfirm() {
    const trimmed = title.trim();
    if (!trimmed) return;
    onConfirm(trimmed, content);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onKeyDown={handleKeyDown}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-card border border-border rounded-[14px] shadow-card dark:shadow-[rgba(0,0,0,0.5)_3px_5px_30px_0px] w-full max-w-xl mx-6 min-h-[420px] p-7 flex flex-col gap-4">
        <h2 className="text-base font-semibold text-foreground">{heading}</h2>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">{t('cardform.title_label')}</label>
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) handleConfirm(); }}
            className="bg-white dark:bg-[#1c1c1e] border border-[#d2d2d7] dark:border-[#333336] rounded-[8px] px-[14px] py-[10px] text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-brand focus:shadow-focus-ring transition-shadow"
            placeholder={t('cardform.title_placeholder')}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">{t('cardform.content_label')}</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={7}
            className="bg-input border border-border rounded-[10px] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-brand focus:shadow-focus-ring transition-shadow resize-none"
            placeholder={t('cardform.content_placeholder')}
          />
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground rounded-[8px] hover:bg-muted transition-colors"
            disabled={isLoading}
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!title.trim() || isLoading}
            className="px-3 py-1.5 text-sm bg-primary hover:opacity-90 text-primary-foreground rounded-[8px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isLoading ? t('cardform.saving') : mode === 'create' ? t('cardform.creating') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
