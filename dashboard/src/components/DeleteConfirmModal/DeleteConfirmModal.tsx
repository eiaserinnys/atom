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
      <div className="bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl w-full max-w-sm mx-4 p-6 flex flex-col gap-4">
        <h2 className="text-base font-semibold text-white">카드 삭제</h2>

        <div className="text-sm text-neutral-300">
          <span className="font-medium text-white">{title}</span>을(를) 삭제하시겠습니까?
        </div>

        {isStructure && (
          <div className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded px-3 py-2">
            ⚠️ 하위 항목도 함께 삭제됩니다.
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-neutral-400 hover:text-white rounded hover:bg-neutral-800 transition-colors"
            disabled={isLoading}
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="px-3 py-1.5 text-sm bg-red-700 hover:bg-red-600 text-white rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isLoading ? '삭제 중…' : '삭제'}
          </button>
        </div>
      </div>
    </div>
  );
}
