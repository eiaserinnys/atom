import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CardData, type TreeNodeData } from '../../api/client';

interface CardDetailProps {
  nodeId: string | null;
}

export function CardDetail({ nodeId }: CardDetailProps) {
  const queryClient = useQueryClient();

  // Editing state
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingContent, setEditingContent] = useState(false);
  const [contentDraft, setContentDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const isDirty = editingTitle || editingContent;

  const { data: node, isLoading, isError } = useQuery<TreeNodeData>({
    queryKey: ['node', nodeId],
    queryFn: () => api.getNode(nodeId!),
    enabled: !!nodeId,
    retry: false,
  });

  const card: CardData | undefined = node?.card;

  // 삭제된 카드 처리 — api.getNode가 404 시 throw하므로 isError로 감지
  if (isError && nodeId && !isLoading) {
    return (
      <div className="h-full flex flex-col bg-background">
        <div className="px-4 py-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground border-b border-border shrink-0">
          카드 상세
        </div>
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          <div className="text-muted-foreground text-sm py-4">이 카드는 삭제되었습니다.</div>
        </div>
      </div>
    );
  }

  const handleRefresh = () => {
    setEditingTitle(false);
    setEditingContent(false);
    queryClient.invalidateQueries({ queryKey: ['node', nodeId] });
  };

  const saveTitle = async () => {
    if (!card) return;
    setSaving(true);
    try {
      await api.updateCard(card.id, { title: titleDraft });
      setEditingTitle(false);
      queryClient.invalidateQueries({ queryKey: ['node', nodeId] });
    } catch (e: unknown) {
      alert(`저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const saveContent = async () => {
    if (!card) return;
    setSaving(true);
    try {
      await api.updateCard(card.id, { content: contentDraft });
      setEditingContent(false);
      queryClient.invalidateQueries({ queryKey: ['node', nodeId] });
    } catch (e: unknown) {
      alert(`저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="px-4 py-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground border-b border-border shrink-0">
        카드 상세
      </div>
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {!nodeId && (
          <div className="text-muted-foreground text-sm">노드를 선택하면 카드 정보가 표시됩니다.</div>
        )}
        {isLoading && <div className="text-muted-foreground text-sm">로딩 중...</div>}

        {/* Dirty State Guard — 편집 중 외부 변경 감지 배너 */}
        {isDirty && card && (
          <div className="flex items-center justify-between gap-2 bg-node-plan/15 border border-node-plan/40 rounded-md px-3 py-2 text-sm text-foreground shrink-0">
            <span className="flex-1">
              편집 중 외부에서 변경되었을 수 있습니다. 저장하지 않은 내용이 있습니다.
            </span>
            <button
              className="bg-node-plan text-white border-none rounded px-2.5 py-0.5 text-[11px] cursor-pointer whitespace-nowrap hover:opacity-85"
              onClick={handleRefresh}
            >
              새로고침
            </button>
          </div>
        )}

        {card && !isLoading && (
          <>
            {/* Title */}
            <div className="flex flex-col gap-1.5">
              <div className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">제목</div>
              {editingTitle ? (
                <div className="flex gap-1.5 items-center">
                  <input
                    className="flex-1 bg-card border border-border rounded px-2.5 py-1.5 text-foreground text-base outline-none font-sans focus:border-node-user"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveTitle()}
                    autoFocus
                  />
                  <button
                    className="bg-node-user text-white border-none rounded px-3 py-1 text-[13px] cursor-pointer font-sans disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={saveTitle}
                    disabled={saving}
                  >
                    {saving ? '...' : '저장'}
                  </button>
                  <button
                    className="bg-transparent text-muted-foreground border border-border rounded px-2.5 py-1 text-[13px] cursor-pointer font-sans hover:bg-muted"
                    onClick={() => setEditingTitle(false)}
                  >
                    취소
                  </button>
                </div>
              ) : (
                <div
                  className="group text-base text-foreground cursor-pointer rounded px-2 py-1.5 border border-transparent relative transition-colors hover:border-border hover:bg-muted"
                  onClick={() => { setTitleDraft(card.title); setEditingTitle(true); }}
                  title="클릭하여 편집"
                >
                  {card.title}
                  <span className="text-[11px] text-muted-foreground ml-1.5 opacity-0 group-hover:opacity-100 transition-opacity">✎</span>
                </div>
              )}
            </div>

            {/* Content */}
            <div className="flex flex-col gap-1.5">
              <div className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">내용</div>
              {editingContent ? (
                <div className="flex flex-col gap-1.5">
                  <textarea
                    className="w-full bg-card border border-border rounded px-2.5 py-2 text-foreground text-[15px] outline-none resize-y font-sans leading-[1.6] focus:border-node-user"
                    value={contentDraft}
                    onChange={(e) => setContentDraft(e.target.value)}
                    rows={8}
                    autoFocus
                  />
                  <div className="flex gap-1.5 items-center">
                    <button
                      className="bg-node-user text-white border-none rounded px-3 py-1 text-[13px] cursor-pointer font-sans disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={saveContent}
                      disabled={saving}
                    >
                      {saving ? '...' : '저장'}
                    </button>
                    <button
                      className="bg-transparent text-muted-foreground border border-border rounded px-2.5 py-1 text-[13px] cursor-pointer font-sans hover:bg-muted"
                      onClick={() => setEditingContent(false)}
                    >
                      취소
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className="group text-base text-foreground cursor-pointer rounded px-2 py-1.5 border border-transparent relative transition-colors hover:border-border hover:bg-muted"
                  onClick={() => { setContentDraft(card.content ?? ''); setEditingContent(true); }}
                  title="클릭하여 편집"
                >
                  {card.content ? (
                    <pre className="font-sans whitespace-pre-wrap break-words text-[15px] leading-[1.6]">{card.content}</pre>
                  ) : (
                    <span className="text-muted-foreground text-sm">내용 없음</span>
                  )}
                  <span className="text-[11px] text-muted-foreground ml-1.5 opacity-0 group-hover:opacity-100 transition-opacity">✎</span>
                </div>
              )}
            </div>

            {/* Read-only fields */}
            <div className="flex flex-col gap-1.5 pt-2 border-t border-border">
              <div className="flex gap-2.5 items-baseline">
                <span className="text-xs text-muted-foreground w-[70px] shrink-0">유형</span>
                <span className={`text-[13px] ${card.card_type === 'structure' ? 'text-node-tool' : 'text-node-response'}`}>
                  {card.card_type}
                </span>
              </div>
              {node?.is_symlink && (
                <div className="flex gap-2.5 items-baseline">
                  <span className="text-xs text-muted-foreground w-[70px] shrink-0">심링크</span>
                  <span className="text-[13px] text-foreground">↗ yes</span>
                </div>
              )}
              {card.source_type && (
                <div className="flex gap-2.5 items-baseline">
                  <span className="text-xs text-muted-foreground w-[70px] shrink-0">출처 유형</span>
                  <span className="text-[13px] text-foreground">{card.source_type}</span>
                </div>
              )}
              {card.source_ref && (
                <div className="flex gap-2.5 items-baseline">
                  <span className="text-xs text-muted-foreground w-[70px] shrink-0">출처 참조</span>
                  <span className="text-[13px] text-foreground break-all">{card.source_ref}</span>
                </div>
              )}
              {card.tags.length > 0 && (
                <div className="flex gap-2.5 items-baseline">
                  <span className="text-xs text-muted-foreground w-[70px] shrink-0">태그</span>
                  <div className="flex flex-wrap gap-1">
                    {card.tags.map((t) => (
                      <span key={t} className="text-xs bg-muted border border-border rounded px-1.5 py-px text-node-plan">{t}</span>
                    ))}
                  </div>
                </div>
              )}
              {card.references.length > 0 && (
                <div className="flex gap-2.5 items-baseline">
                  <span className="text-xs text-muted-foreground w-[70px] shrink-0">참조</span>
                  <span className="text-[13px] text-foreground">{card.references.join(', ')}</span>
                </div>
              )}
              <div className="flex gap-2.5 items-baseline">
                <span className="text-xs text-muted-foreground w-[70px] shrink-0">staleness</span>
                <span className="text-[13px] text-foreground">{card.staleness}</span>
              </div>
              <div className="flex gap-2.5 items-baseline">
                <span className="text-xs text-muted-foreground w-[70px] shrink-0">버전</span>
                <span className="text-[13px] text-foreground">{card.version}</span>
              </div>
              <div className="flex gap-2.5 items-baseline">
                <span className="text-xs text-muted-foreground w-[70px] shrink-0">수정일</span>
                <span className="text-[13px] text-foreground">
                  {new Date(card.updated_at).toLocaleString('ko-KR')}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
