import { useEffect, useRef, useState } from 'react';

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
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const heading =
    mode === 'create'
      ? cardType === 'structure'
        ? '새 구조 카드'
        : '새 지식 카드'
      : '카드 수정';

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onKeyDown={handleKeyDown}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl w-full max-w-md mx-4 p-6 flex flex-col gap-4">
        <h2 className="text-base font-semibold text-white">{heading}</h2>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-neutral-400">제목</label>
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) handleConfirm(); }}
            className="bg-neutral-800 border border-neutral-600 rounded px-3 py-1.5 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-400"
            placeholder="제목 입력"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-neutral-400">본문 (선택)</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={5}
            className="bg-neutral-800 border border-neutral-600 rounded px-3 py-1.5 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-400 resize-none"
            placeholder="마크다운 형식으로 입력"
          />
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-neutral-400 hover:text-white rounded hover:bg-neutral-800 transition-colors"
            disabled={isLoading}
          >
            취소
          </button>
          <button
            onClick={handleConfirm}
            disabled={!title.trim() || isLoading}
            className="px-3 py-1.5 text-sm bg-neutral-700 hover:bg-neutral-600 text-white rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isLoading ? '저장 중…' : mode === 'create' ? '생성' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
