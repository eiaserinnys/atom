import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { api, type CardData, type TreeNodeData } from '../../api/client';
import i18n from '../../i18n';

interface CardDetailProps {
  nodeId: string | null;
}

export function CardDetail({ nodeId }: CardDetailProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // Editing state
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingContent, setEditingContent] = useState(false);
  const [contentDraft, setContentDraft] = useState('');
  const [editingJournalLimit, setEditingJournalLimit] = useState(false);
  const [journalLimitDraft, setJournalLimitDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const isDirty = editingTitle || editingContent || editingJournalLimit;

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
        <div className="h-10 px-4 flex items-center text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground border-b border-border bg-card shrink-0">
          {t('card.header')}
        </div>
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          <div className="text-muted-foreground text-sm py-4">{t('card.deleted')}</div>
        </div>
      </div>
    );
  }

  const handleRefresh = () => {
    setEditingTitle(false);
    setEditingContent(false);
    setEditingJournalLimit(false);
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
      alert(`${t('card.save_failed')}: ${e instanceof Error ? e.message : String(e)}`);
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
      alert(`${t('card.save_failed')}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const saveJournalLimit = async () => {
    if (!nodeId) return;
    const val = journalLimitDraft.trim();
    const parsed = val === '' ? null : parseInt(val, 10);
    // 유효하지 않은 값(음수, 비정수) 무시
    if (val !== '' && (isNaN(parsed!) || parsed! < 0)) {
      setEditingJournalLimit(false);
      return;
    }
    setSaving(true);
    try {
      await api.updateNode(nodeId, { journal_limit: parsed });
      setEditingJournalLimit(false);
      queryClient.invalidateQueries({ queryKey: ['node', nodeId] });
    } catch (e: unknown) {
      alert(`${t('card.save_failed')}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="h-10 px-4 flex items-center text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground border-b border-border bg-card shrink-0">
        {t('card.header')}
      </div>
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {!nodeId && (
          <div className="text-muted-foreground text-sm">{t('card.no_selection')}</div>
        )}
        {isLoading && <div className="text-muted-foreground text-sm">{t('common.loading')}</div>}

        {/* Dirty State Guard — 편집 중 외부 변경 감지 배너 */}
        {isDirty && card && (
          <div className="flex items-center justify-between gap-2 bg-brand/8 border border-brand/25 rounded-md px-3 py-2 text-sm text-foreground shrink-0">
            <span className="flex-1">
              {t('card.unsaved_changes')}
            </span>
            <button
              className="bg-brand text-white border-none rounded px-2.5 py-0.5 text-[11px] cursor-pointer whitespace-nowrap hover:opacity-85"
              onClick={handleRefresh}
            >
              {t('card.refresh')}
            </button>
          </div>
        )}

        {card && !isLoading && (
          <>
            {/* Title */}
            <div className="flex flex-col gap-1.5">
              <div className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">{t('card.title_label')}</div>
              {editingTitle ? (
                <div className="flex gap-1.5 items-center">
                  <input
                    className="flex-1 bg-white dark:bg-[#1c1c1e] border border-[#d2d2d7] dark:border-[#333336] rounded-[8px] px-[14px] py-[10px] text-foreground text-base font-sans focus:outline-none focus:border-brand focus:shadow-focus-ring transition-shadow"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveTitle()}
                    autoFocus
                  />
                  <button
                    className="bg-brand text-white border-none rounded px-3 py-1 text-[13px] cursor-pointer font-sans disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={saveTitle}
                    disabled={saving}
                  >
                    {saving ? '...' : t('common.save')}
                  </button>
                  <button
                    className="bg-transparent text-muted-foreground border border-border rounded px-2.5 py-1 text-[13px] cursor-pointer font-sans hover:bg-muted"
                    onClick={() => setEditingTitle(false)}
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              ) : (
                <div
                  className="group text-base text-foreground cursor-pointer rounded px-2 py-1.5 border border-transparent relative transition-colors hover:border-border hover:bg-muted"
                  onClick={() => { setTitleDraft(card.title); setEditingTitle(true); }}
                  title={t('card.click_to_edit')}
                >
                  {card.title}
                  <span className="text-[11px] text-muted-foreground ml-1.5 opacity-0 group-hover:opacity-100 transition-opacity">✎</span>
                </div>
              )}
            </div>

            {/* Content */}
            <div className="flex flex-col gap-1.5">
              <div className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">{t('card.content_label')}</div>
              {editingContent ? (
                <div className="flex flex-col gap-1.5">
                  <textarea
                    className="w-full bg-white dark:bg-[#1c1c1e] border border-[#d2d2d7] dark:border-[#333336] rounded-[8px] px-[14px] py-[10px] text-foreground text-[15px] resize-y font-sans leading-[1.6] focus:outline-none focus:border-brand focus:shadow-focus-ring transition-shadow"
                    value={contentDraft}
                    onChange={(e) => setContentDraft(e.target.value)}
                    rows={8}
                    autoFocus
                  />
                  <div className="flex gap-1.5 items-center">
                    <button
                      className="bg-brand text-white border-none rounded px-3 py-1 text-[13px] cursor-pointer font-sans disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={saveContent}
                      disabled={saving}
                    >
                      {saving ? '...' : t('common.save')}
                    </button>
                    <button
                      className="bg-transparent text-muted-foreground border border-border rounded px-2.5 py-1 text-[13px] cursor-pointer font-sans hover:bg-muted"
                      onClick={() => setEditingContent(false)}
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className="group text-base text-foreground cursor-pointer rounded px-2 py-1.5 border border-transparent relative transition-colors hover:border-border hover:bg-muted"
                  onClick={() => { setContentDraft(card.content ?? ''); setEditingContent(true); }}
                  title={t('card.click_to_edit')}
                >
                  {card.content ? (
                    <div className="prose prose-atom text-[15px] leading-relaxed">
                      <Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>{card.content}</Markdown>
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-sm">{t('card.empty_content')}</span>
                  )}
                  <span className="text-[11px] text-muted-foreground ml-1.5 opacity-0 group-hover:opacity-100 transition-opacity">✎</span>
                </div>
              )}
            </div>

            {/* Read-only fields */}
            <div className="flex flex-col gap-1.5 pt-2 border-t border-border">
              <div className="flex gap-2.5 items-baseline">
                <span className="text-xs text-muted-foreground w-[70px] shrink-0">{t('card.type_label')}</span>
                <span className="text-[13px] text-muted-foreground">
                  {card.card_type}
                </span>
              </div>
              {node?.is_symlink && (
                <div className="flex gap-2.5 items-baseline">
                  <span className="text-xs text-muted-foreground w-[70px] shrink-0">{t('card.symlink_label')}</span>
                  <span className="text-[13px] text-foreground">↗ yes</span>
                </div>
              )}
              {card.source_type && (
                <div className="flex gap-2.5 items-baseline">
                  <span className="text-xs text-muted-foreground w-[70px] shrink-0">{t('card.source_type_label')}</span>
                  <span className="text-[13px] text-foreground">{card.source_type}</span>
                </div>
              )}
              {card.source_ref && (
                <div className="flex gap-2.5 items-baseline">
                  <span className="text-xs text-muted-foreground w-[70px] shrink-0">{t('card.source_ref_label')}</span>
                  {/^https?:\/\//.test(card.source_ref) ? (
                    <a
                      href={card.source_ref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[13px] text-primary underline break-all"
                    >
                      {card.source_ref}
                    </a>
                  ) : (
                    <span className="text-[13px] text-foreground break-all">{card.source_ref}</span>
                  )}
                </div>
              )}
              {card.tags.length > 0 && (
                <div className="flex gap-2.5 items-baseline">
                  <span className="text-xs text-muted-foreground w-[70px] shrink-0">{t('card.tags_label')}</span>
                  <div className="flex flex-wrap gap-1">
                    {card.tags.map((tag) => (
                      <span key={tag} className="text-xs bg-muted border border-border rounded px-1.5 py-px text-foreground">{tag}</span>
                    ))}
                  </div>
                </div>
              )}
              {card.references.length > 0 && (
                <div className="flex gap-2.5 items-baseline">
                  <span className="text-xs text-muted-foreground w-[70px] shrink-0">{t('card.refs_label')}</span>
                  <span className="text-[13px] text-foreground">{card.references.join(', ')}</span>
                </div>
              )}
              <div className="flex gap-2.5 items-baseline">
                <span className="text-xs text-muted-foreground w-[70px] shrink-0">journal limit</span>
                {editingJournalLimit ? (
                  <div className="flex gap-1.5 items-center flex-1">
                    <input
                      type="number"
                      min="0"
                      className="w-20 bg-white dark:bg-[#1c1c1e] border border-[#d2d2d7] dark:border-[#333336] rounded-[6px] px-2 py-1 text-foreground text-[13px] font-sans focus:outline-none focus:border-brand"
                      value={journalLimitDraft}
                      placeholder="빈값=무제한"
                      onChange={(e) => setJournalLimitDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveJournalLimit(); if (e.key === 'Escape') setEditingJournalLimit(false); }}
                      autoFocus
                    />
                    <button
                      className="bg-brand text-white border-none rounded px-2.5 py-0.5 text-[11px] cursor-pointer font-sans disabled:opacity-50"
                      onClick={saveJournalLimit}
                      disabled={saving}
                    >
                      {saving ? '...' : t('common.save')}
                    </button>
                    <button
                      className="bg-transparent text-muted-foreground border border-border rounded px-2 py-0.5 text-[11px] cursor-pointer font-sans hover:bg-muted"
                      onClick={() => setEditingJournalLimit(false)}
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                ) : (
                  <span
                    className="group text-[13px] text-foreground cursor-pointer rounded px-1 py-0.5 border border-transparent hover:border-border hover:bg-muted"
                    onClick={() => {
                      const cur = node?.journal_limit;
                      setJournalLimitDraft(cur !== null && cur !== undefined ? String(cur) : '');
                      setEditingJournalLimit(true);
                    }}
                    title={t('card.click_to_edit')}
                  >
                    {node?.journal_limit !== null && node?.journal_limit !== undefined
                      ? `최근 ${node.journal_limit === 0 ? '전체' : node.journal_limit + '개'}`
                      : <span className="text-muted-foreground">—</span>}
                    <span className="text-[10px] text-muted-foreground ml-1 opacity-0 group-hover:opacity-100 transition-opacity">✎</span>
                  </span>
                )}
              </div>
              <div className="flex gap-2.5 items-baseline">
                <span className="text-xs text-muted-foreground w-[70px] shrink-0">staleness</span>
                <span className="text-[13px] text-foreground">{card.staleness}</span>
              </div>
              <div className="flex gap-2.5 items-baseline">
                <span className="text-xs text-muted-foreground w-[70px] shrink-0">{t('card.version_label')}</span>
                <span className="text-[13px] text-foreground">{card.version}</span>
              </div>
              <div className="flex gap-2.5 items-baseline">
                <span className="text-xs text-muted-foreground w-[70px] shrink-0">{t('card.updated_at_label')}</span>
                <span className="text-[13px] text-foreground">
                  {new Date(card.updated_at).toLocaleString(i18n.language)}
                </span>
              </div>
              {card.created_by && (
                <div className="flex gap-2.5 items-baseline">
                  <span className="text-xs text-muted-foreground w-[70px] shrink-0">{t('card.created_by_label')}</span>
                  <span className="text-[13px] text-foreground">{card.created_by}</span>
                </div>
              )}
              {card.updated_by && card.updated_by !== card.created_by && (
                <div className="flex gap-2.5 items-baseline">
                  <span className="text-xs text-muted-foreground w-[70px] shrink-0">{t('card.updated_by_label')}</span>
                  <span className="text-[13px] text-foreground">{card.updated_by}</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
