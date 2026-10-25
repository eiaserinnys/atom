export type CenterMode = 'compile' | 'search';
export function CenterTabs({ mode, onChange }: { mode: CenterMode; onChange(mode: CenterMode): void }) {
  return <div className="center-tabs text-muted-foreground" role="tablist" aria-label="중앙 워크스페이스">
    <button role="tab" aria-selected={mode === 'compile'} onClick={() => onChange('compile')}>컴파일 문서</button>
    <button role="tab" aria-selected={mode === 'search'} onClick={() => onChange('search')}>검색 모션</button>
  </div>;
}
