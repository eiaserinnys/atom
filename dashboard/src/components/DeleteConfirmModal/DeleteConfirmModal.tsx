import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AlertTriangle } from 'lucide-react';
import { Spinner } from '../Spinner';
import { useDialogKeyboard } from '../../hooks/useDialogKeyboard';

export type DeletePreviewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; deletedCardCount: number };

interface DeleteConfirmModalProps {
  title: string;
  isSymlink?: boolean;
  preview?: DeletePreviewState;
  onConfirm: () => void;
  onClose: () => void;
  isLoading?: boolean;
  errorMessage?: string;
}

function renderPermanentNotice(preview: DeletePreviewState | undefined, t: TFunction) {
  if (preview?.status === 'loading') {
    return (
      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <Spinner size="sm" />
        {t('delete_modal.checking')}
      </div>
    );
  }
  if (preview?.status === 'ready' && preview.deletedCardCount === 0) {
    return <div className="text-[13px] text-muted-foreground">{t('delete_modal.cards_none')}</div>;
  }
  return (
    <div className="flex items-center gap-2 text-[13px] text-foreground bg-[var(--amber-soft)] border border-[var(--amber)]/30 rounded-none px-3 py-2">
      <AlertTriangle className="w-4 h-4 shrink-0 text-[var(--amber)]" strokeWidth={1.75} />
      {preview?.status === 'ready'
        ? t('delete_modal.cards_permanent', { total: preview.deletedCardCount })
        : t('delete_modal.cards_unknown')}
    </div>
  );
}

export function DeleteConfirmModal({
  title,
  isSymlink = false,
  preview,
  onConfirm,
  onClose,
  isLoading = false,
  errorMessage,
}: DeleteConfirmModalProps) {
  const { t } = useTranslation();
  const isChecking = !isSymlink && preview?.status === 'loading';
  const notice = isSymlink ? null : renderPermanentNotice(preview, t);

  const titleId = useId();
  const frameRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useDialogKeyboard({ frameRef, initialFocusRef: cancelRef, onClose, isBusy: isLoading });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 dark:bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget && !isLoading) onClose(); }}
    >
      <div
        ref={frameRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-card border border-border rounded-none shadow-card w-full max-w-sm mx-4 p-6 flex flex-col gap-4 [&:lang(ko)]:break-keep [overflow-wrap:anywhere]"
      >
        <h2 id={titleId} className="text-base font-semibold text-foreground">{t(isSymlink ? 'delete_modal.title_link' : 'delete_modal.title_node')}</h2>

        <div className="text-sm text-foreground">
          {t(isSymlink ? 'delete_modal.body_link' : 'delete_modal.body_node', { name: title })}
        </div>

        {notice}

        {errorMessage && (
          <div className="text-[13px] text-node-error">{errorMessage}</div>
        )}

        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground rounded-none hover:bg-muted transition-colors"
            disabled={isLoading}
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading || isChecking}
            className="px-3 py-1.5 text-sm bg-node-error hover:opacity-90 text-primary-foreground rounded-none transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            {isLoading && <Spinner size="sm" />}{t('delete_modal.confirm_btn')}
          </button>
        </div>
      </div>
    </div>
  );
}
