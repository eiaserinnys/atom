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
 * 헤딩 텍스트에서 섹션 번호(1.2.3 형태)와 HTML 주석을 제거하여 순수 제목만 반환.
 * 서버 마크다운 예시: "## 1.2 카드 제목 <!-- node:xxx card:yyy -->"
 * 렌더링 시 children은 이미 HTML 주석이 제거된 상태일 수 있으므로 번호만 제거하면 된다.
 */
function extractCleanTitle(children: React.ReactNode): string {
  return String(children ?? '')
    .replace(/^[\d.]+\s+/, '')       // 선행 섹션 번호 제거 (e.g. "1.2 ")
    .replace(/<!--.*?-->/gs, '')      // HTML 주석 제거 (react-markdown이 남길 경우)
    .trim();
}

/**
 * 헤딩 텍스트에서 node ID를 추출.
 * react-markdown이 children으로 전달하는 텍스트에 <!-- node:ID card:ID --> 주석이
 * 포함될 수 있으므로 정규식으로 추출한다.
 */
function extractNodeId(children: React.ReactNode): string | null {
  const text = String(children ?? '');
  const m = text.match(/<!--\s*node:(\S+)/);
  return m ? m[1]! : null;
}

export function EditableHeading({ level, children, sectionMap, compiledNodeId }: EditableHeadingProps) {
  const { t } = useTranslation();
  const [showModal, setShowModal] = useState(false);
  const [cardData, setCardData] = useState<{ title: string; content: string } | null>(null);
  const [loadingCard, setLoadingCard] = useState(false);
  const queryClient = useQueryClient();

  const cleanTitle = extractCleanTitle(children);
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
        <span>{cleanTitle}</span>
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
