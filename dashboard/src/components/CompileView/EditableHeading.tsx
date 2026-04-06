import { useState, type ElementType } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { CardFormModal } from '../CardFormModal/CardFormModal';
import type { SectionMap } from '../../utils/parseCompileSections';

interface EditableHeadingProps {
  level: number;
  children: React.ReactNode;
  sectionMap: SectionMap;
  compiledNodeId: string; // 컴파일 뷰의 루트 노드ID (캐시 invalidate 시 사용)
}

/**
 * react-markdown은 heading children을 배열로 전달한다.
 * (예: ["1.2 카드 제목 ", "<!-- node:xxx card:yyy -->"])
 * String(array)는 쉼표로 join하므로, 직접 문자열만 이어붙인다.
 */
function joinChildren(children: React.ReactNode): string {
  if (Array.isArray(children)) {
    return children.map(c => (typeof c === 'string' ? c : '')).join('');
  }
  return String(children ?? '');
}

/**
 * HTML 주석 제거, 섹션 번호 유지 — 화면 표시용.
 * 서버 마크다운 예시: "## 1.2 카드 제목 <!-- node:xxx card:yyy -->"
 * 결과: "1.2 카드 제목"
 */
function extractDisplayTitle(children: React.ReactNode): string {
  return joinChildren(children)
    .replace(/<!--.*?-->/gs, '')
    .trim();
}

/**
 * HTML 주석 + 선행 번호 제거 — 편집 모달 초기값용.
 * (실제로는 api.getCard가 clean title을 반환하므로 편집 모달에서는 미사용이나 유지)
 */
function extractCleanTitle(children: React.ReactNode): string {
  return extractDisplayTitle(children)
    .replace(/^[\d.]+\s+/, '');
}

/**
 * 헤딩 텍스트에서 node ID를 추출.
 */
function extractNodeId(children: React.ReactNode): string | null {
  const text = joinChildren(children);
  const m = text.match(/<!--\s*node:(\S+)/);
  return m ? m[1]! : null;
}

export function EditableHeading({ level, children, sectionMap, compiledNodeId }: EditableHeadingProps) {
  const { t } = useTranslation();
  const [showModal, setShowModal] = useState(false);
  const [cardData, setCardData] = useState<{ title: string; content: string } | null>(null);
  const [loadingCard, setLoadingCard] = useState(false);
  const queryClient = useQueryClient();

  const displayTitle = extractDisplayTitle(children);
  const cleanTitle = extractCleanTitle(children); // 호환성 유지
  const nodeId = extractNodeId(children);
  const sectionInfo = nodeId ? sectionMap.get(nodeId) : null;

  const editMutation = useMutation({
    mutationFn: (vars: { cardId: string; title: string; content: string }) =>
      api.updateCard(vars.cardId, { title: vars.title, content: vars.content || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compile', compiledNodeId] });
      setShowModal(false);
      setCardData(null);
    },
  });

  async function handleEditClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!sectionInfo) return;

    setLoadingCard(true);
    try {
      const card = await api.getCard(sectionInfo.cardId);
      setCardData({ title: card.title, content: card.content ?? '' });
      setShowModal(true);
    } finally {
      setLoadingCard(false);
    }
  }

  function handleConfirm(title: string, content: string) {
    if (!sectionInfo || !cardData) return;
    editMutation.mutate({ cardId: sectionInfo.cardId, title, content });
  }

  const HeadingTag = `h${level}` as ElementType;

  return (
    <>
      <HeadingTag className="group relative flex items-center gap-2">
        <span>{displayTitle}</span>
        {sectionInfo && (
          <button
            onClick={handleEditClick}
            disabled={loadingCard}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
            title={t('card.edit_title')}
          >
            {loadingCard ? (
              <span className="text-[10px]">…</span>
            ) : (
              <Pencil className="w-3 h-3" />
            )}
          </button>
        )}
      </HeadingTag>

      {showModal && cardData && sectionInfo && (
        <CardFormModal
          mode="edit"
          initialTitle={cardData.title}
          initialContent={cardData.content}
          onConfirm={handleConfirm}
          onClose={() => { setShowModal(false); setCardData(null); }}
          isLoading={editMutation.isPending}
        />
      )}
    </>
  );
}
