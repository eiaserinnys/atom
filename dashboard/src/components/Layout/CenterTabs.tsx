import { useTranslation } from 'react-i18next';
export type CenterMode = 'compile' | 'search';
export function CenterTabs({ mode, onChange }: { mode: CenterMode; onChange(mode: CenterMode): void }) {
  const { t } = useTranslation();
  return <div className="center-tabs text-muted-foreground" role="tablist" aria-label="중앙 워크스페이스">
    <button role="tab" aria-selected={mode === 'compile'} onClick={() => onChange('compile')}>{t('compile.header')}</button>
    <button role="tab" aria-selected={mode === 'search'} onClick={() => onChange('search')}>{t('visual_search.title')}</button>
  </div>;
}
