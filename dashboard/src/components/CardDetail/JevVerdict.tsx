import type { MotionNode } from '../SearchMotionView/types';
export function JevVerdict({ verdict }: { verdict: MotionNode }) {
  const summary = verdict.summary || (verdict.path?.length ? verdict.path.join(' › ') : '');
  return <section className="border border-border bg-card p-3 text-[13px]" aria-label="Jev 판정">
    <div className="flex items-center justify-between gap-2">
      <strong className="bg-brand text-brand-foreground px-1.5 py-0.5 font-mono">{verdict.selected ? `선정 #${verdict.rank}` : verdict.reason} {verdict.score !== null ? `(${verdict.score.toFixed(2)})` : ''}</strong>
      <span className="text-muted-foreground font-mono">{verdict.columnLabel ?? (verdict.hop === 0 ? '입구' : `홉 ${verdict.hop}`)}{verdict.sample ? ' · 표본' : ''}</span>
    </div>
    {summary && <p className="mt-2 truncate" title={summary}>{summary}</p>}
    {verdict.sentText && <details className="mt-2"><summary className="cursor-pointer">Jev에 보낸 글</summary><pre className="mt-2 whitespace-pre-wrap break-words font-mono">{verdict.sentText}</pre></details>}
  </section>;
}
