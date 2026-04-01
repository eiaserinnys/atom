import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CardData, type TreeNodeData } from '../../api/client';
import styles from './CardDetail.module.css';

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
      <div className={styles.container}>
        <div className={styles.header}>카드 상세</div>
        <div className={styles.content}>
          <div className={styles.cardDeletedNotice}>이 카드는 삭제되었습니다.</div>
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
    <div className={styles.container}>
      <div className={styles.header}>카드 상세</div>
      <div className={styles.content}>
        {!nodeId && (
          <div className={styles.empty}>노드를 선택하면 카드 정보가 표시됩니다.</div>
        )}
        {isLoading && <div className={styles.status}>로딩 중...</div>}

        {/* Dirty State Guard — 편집 중 외부 변경 감지 배너 */}
        {isDirty && card && (
          <div className={styles.dirtyBanner}>
            <span className={styles.dirtyBannerText}>
              편집 중 외부에서 변경되었을 수 있습니다. 저장하지 않은 내용이 있습니다.
            </span>
            <button className={styles.btnRefresh} onClick={handleRefresh}>
              새로고침
            </button>
          </div>
        )}

        {card && !isLoading && (
          <>
            {/* Title */}
            <div className={styles.field}>
              <div className={styles.fieldLabel}>제목</div>
              {editingTitle ? (
                <div className={styles.editRow}>
                  <input
                    className={styles.input}
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveTitle()}
                    autoFocus
                  />
                  <button className={styles.btnSave} onClick={saveTitle} disabled={saving}>
                    {saving ? '...' : '저장'}
                  </button>
                  <button className={styles.btnCancel} onClick={() => setEditingTitle(false)}>
                    취소
                  </button>
                </div>
              ) : (
                <div
                  className={styles.fieldValue}
                  onClick={() => { setTitleDraft(card.title); setEditingTitle(true); }}
                  title="클릭하여 편집"
                >
                  {card.title}
                  <span className={styles.editHint}>✎</span>
                </div>
              )}
            </div>

            {/* Content */}
            <div className={styles.field}>
              <div className={styles.fieldLabel}>내용</div>
              {editingContent ? (
                <div className={styles.editCol}>
                  <textarea
                    className={styles.textarea}
                    value={contentDraft}
                    onChange={(e) => setContentDraft(e.target.value)}
                    rows={8}
                    autoFocus
                  />
                  <div className={styles.editRow}>
                    <button className={styles.btnSave} onClick={saveContent} disabled={saving}>
                      {saving ? '...' : '저장'}
                    </button>
                    <button className={styles.btnCancel} onClick={() => setEditingContent(false)}>
                      취소
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className={styles.fieldValue}
                  onClick={() => { setContentDraft(card.content ?? ''); setEditingContent(true); }}
                  title="클릭하여 편집"
                >
                  {card.content ? (
                    <pre className={styles.contentPre}>{card.content}</pre>
                  ) : (
                    <span className={styles.empty}>내용 없음</span>
                  )}
                  <span className={styles.editHint}>✎</span>
                </div>
              )}
            </div>

            {/* Read-only fields */}
            <div className={styles.metaSection}>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>유형</span>
                <span className={`${styles.metaValue} ${styles[card.card_type]}`}>
                  {card.card_type}
                </span>
              </div>
              {node?.is_symlink && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>심링크</span>
                  <span className={styles.metaValue}>↗ yes</span>
                </div>
              )}
              {card.source_type && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>출처 유형</span>
                  <span className={styles.metaValue}>{card.source_type}</span>
                </div>
              )}
              {card.source_ref && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>출처 참조</span>
                  <span className={styles.metaValueBreak}>{card.source_ref}</span>
                </div>
              )}
              {card.tags.length > 0 && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>태그</span>
                  <div className={styles.tagList}>
                    {card.tags.map((t) => (
                      <span key={t} className={styles.tag}>{t}</span>
                    ))}
                  </div>
                </div>
              )}
              {card.references.length > 0 && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>참조</span>
                  <span className={styles.metaValue}>{card.references.join(', ')}</span>
                </div>
              )}
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>staleness</span>
                <span className={styles.metaValue}>{card.staleness}</span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>버전</span>
                <span className={styles.metaValue}>{card.version}</span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>수정일</span>
                <span className={styles.metaValue}>
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
