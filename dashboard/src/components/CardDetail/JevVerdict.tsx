import { useTranslation } from 'react-i18next';
import type { MotionNode } from '../SearchMotionView/types';
export function JevVerdict({ verdict }: { verdict: MotionNode }) {
  const { t } = useTranslation();
  const summary = verdict.summary || (verdict.path?.length ? verdict.path.join(' › ') : '');
  return <section className="border border-border bg-card p-3 text-[13px]" aria-label={t('visual_search.verdict')}>
    <div className="flex items-center justify-between gap-2">
      <strong className="bg-brand text-brand-foreground px-1.5 py-0.5 font-mono">{verdict.selected ? t('visual_search.v_selected', { rank: verdict.rank }) : verdict.reason} {verdict.score !== null ? `(${verdict.score.toFixed(2)})` : ''}</strong>
      <span className="text-muted-foreground font-mono">{verdict.columnLabel ?? (verdict.hop === 0 ? t('visual_search.entry') : t('visual_search.hop', { count: verdict.hop }))}</span>
    </div>
    {summary && <p className="mt-2 truncate" title={summary}>{summary}</p>}
    {verdict.sentText && <details className="mt-2"><summary className="cursor-pointer">{t('visual_search.sent')}</summary><pre className="mt-2 whitespace-pre-wrap break-words font-mono">{verdict.sentText}</pre></details>}
  </section>;
}
