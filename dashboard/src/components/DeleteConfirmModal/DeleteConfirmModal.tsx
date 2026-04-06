import { useTranslation } from 'react-i18next';

interface DeleteConfirmModalProps {
  title: string;
  isStructure: boolean;
  onConfirm: () => void;
  onClose: () => void;
  isLoading?: boolean;
}

export function DeleteConfirmModal({
  title,
  isStructure,
  onConfirm,
  onClose,
  isLoading = false,
}: DeleteConfirmModalProps) {
  const { t } = useTranslation();

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter') onConfirm();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onKeyDown={handleKeyDown}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-card border border-border rounded-lg shadow-card w-full max-w-sm mx-4 p-6 flex flex-col gap-4">
        <h2 className="text-base font-semibold text-foreground">{t('delete_modal.title')}</h2>

        <div className="text-sm text-foreground">
          {t('delete_modal.desc', { name: title })}
        </div>

        {isStructure && (
          <div className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded px-3 py-2">
            {t('delete_modal.sub_items_warning')}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground rounded hover:bg-muted transition-colors"
            disabled={isLoading}
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="px-3 py-1.5 text-sm bg-node-error hover:opacity-90 text-white rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isLoading ? t('delete_modal.deleting') : t('delete_modal.confirm_btn')}
          </button>
        </div>
      </div>
    </div>
  );
}
