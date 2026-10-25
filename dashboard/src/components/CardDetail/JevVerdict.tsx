import type { MotionNode } from '../SearchMotionView/types';
export function JevVerdict({ verdict }: { verdict: MotionNode }) {
  return <section className="border border-border bg-card p-3 text-[13px]" aria-label="Jev 판정">
    <div className="flex items-center justify-between gap-2">
      <strong className="bg-brand text-brand-foreground px-1.5 py-0.5 font-mono">{verdict.selected ? `선정 #${verdict.rank}` : verdict.reason} {verdict.score !== null ? `(${verdict.score.toFixed(2)})` : ''}</strong>
      {verdict.sample && <span className="text-muted-foreground">표본</span>}
    </div>
    <p className="mt-2 truncate" title={verdict.reason}>{verdict.reason}</p>
    {verdict.sentText && <details className="mt-2"><summary className="cursor-pointer">Jev에 보낸 글</summary><pre className="mt-2 whitespace-pre-wrap break-words font-mono">{verdict.sentText}</pre></details>}
  </section>;
}
