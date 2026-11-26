import { useTranslation } from 'react-i18next';
export type CenterMode = 'compile' | 'search';
export function CenterTabs({ mode, onChange, visualSearch = true }: { mode: CenterMode; onChange(mode: CenterMode): void; visualSearch?: boolean }) {
  const { t } = useTranslation();
  return <div className="center-tabs text-muted-foreground" role="tablist" aria-label={t('visual_search.workspace')}>
    <button role="tab" aria-selected={mode === 'compile'} onClick={() => onChange('compile')}>{t('compile.header')}</button>
    {visualSearch && <button role="tab" aria-selected={mode === 'search'} onClick={() => onChange('search')}>{t('visual_search.title')}</button>}
  </div>;
}
