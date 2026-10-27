import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { Spinner } from '../Spinner';

interface DeleteConfirmModalProps {
  title: string;
  isStructure: boolean;
  onConfirm: () => void;
  onClose: () => void;
  isLoading?: boolean;
  errorMessage?: string;
}

export function DeleteConfirmModal({
  title,
  isStructure,
  onConfirm,
  onClose,
  isLoading = false,
  errorMessage,
}: DeleteConfirmModalProps) {
  const { t } = useTranslation();

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 dark:bg-black/70"
      onKeyDown={handleKeyDown}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-card border border-border rounded-none shadow-card w-full max-w-sm mx-4 p-6 flex flex-col gap-4">
        <h2 className="text-base font-semibold text-foreground">{t('delete_modal.title')}</h2>

        <div className="text-sm text-foreground">
          {t('delete_modal.desc', { name: title })}
        </div>

        {isStructure && (
          <div className="flex items-center gap-2 text-[13px] text-foreground bg-[var(--amber-soft)] border border-[var(--amber)]/30 rounded-none px-3 py-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-[var(--amber)]" strokeWidth={1.75} />
            {t('delete_modal.sub_items_warning')}
          </div>
        )}

        {errorMessage && (
          <div className="text-[13px] text-node-error">{errorMessage}</div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground rounded-none hover:bg-muted transition-colors"
            disabled={isLoading}
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="px-3 py-1.5 text-sm bg-node-error hover:opacity-90 text-primary-foreground rounded-none transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            {isLoading && <Spinner size="sm" />}{t('delete_modal.confirm_btn')}
          </button>
        </div>
      </div>
    </div>
  );
}
