import { useEffect, useState } from 'react';
import { api, type CardData, type TreeNodeData } from '../../api/client';
import styles from './CardDetail.module.css';

interface CardDetailProps {
  nodeId: string | null;
}

export function CardDetail({ nodeId }: CardDetailProps) {
  const [node, setNode] = useState<TreeNodeData | null>(null);
  const [card, setCard] = useState<CardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editing state
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingContent, setEditingContent] = useState(false);
  const [contentDraft, setContentDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!nodeId) {
      setNode(null);
      setCard(null);
      return;
    }
    setLoading(true);
    setError(null);
    setEditingTitle(false);
    setEditingContent(false);
    api.getNode(nodeId)
      .then((n) => {
        setNode(n);
        setCard(n.card);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [nodeId]);

  const saveTitle = async () => {
    if (!card) return;
    setSaving(true);
    try {
      const updated = await api.updateCard(card.id, { title: titleDraft });
      setCard(updated);
      setEditingTitle(false);
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
      const updated = await api.updateCard(card.id, { content: contentDraft });
      setCard(updated);
      setEditingContent(false);
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
        {loading && <div className={styles.status}>로딩 중...</div>}
        {error && <div className={styles.statusError}>오류: {error}</div>}

        {card && !loading && (
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
