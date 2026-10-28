import { useState, type ElementType } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil } from 'lucide-react';
export type SectionMap = Map<string, { nodeId: string; cardId: string }>;

interface EditableHeadingProps {
  level: number;
  children: React.ReactNode;
  sectionMap: SectionMap;
  onEditCard: (cardId: string) => Promise<void>;
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


function extractDisplayTitle(children: React.ReactNode): string {
  return joinChildren(children)
    .replace(/<!--.*?-->/gs, '')
    .trim();
}


/**
 * 헤딩 텍스트에서 node ID를 추출.
 */
function extractNodeId(children: React.ReactNode): string | null {
  const text = joinChildren(children);
  const m = text.match(/<!--\s*node:(\S+)/);
  return m ? m[1]! : null;
}

export function EditableHeading({ level, children, sectionMap, onEditCard }: EditableHeadingProps) {
  const { t } = useTranslation();
  const [loadingCard, setLoadingCard] = useState(false);

  const displayTitle = extractDisplayTitle(children);
  const nodeId = extractNodeId(children);
  const sectionInfo = nodeId ? sectionMap.get(nodeId) : null;

  async function handleEditClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!sectionInfo) return;

    setLoadingCard(true);
    try {
      await onEditCard(sectionInfo.cardId);
    } finally {
      setLoadingCard(false);
    }
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
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded-none hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
            title={t('card.edit_title')}
          >
            {loadingCard ? (
              <span className="text-[13px]">…</span>
            ) : (
              <Pencil className="w-3 h-3" />
            )}
          </button>
        )}
      </HeadingTag>

    </>
  );
}
