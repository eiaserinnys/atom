import { lazy, Suspense } from 'react';
import type { SearchMotionViewProps } from './SearchMotionView';
import { useTranslation } from 'react-i18next';
const Motion = lazy(() => import('./SearchMotionView').then(module => ({ default: module.SearchMotionView })));
export function LazySearchMotionView(props: SearchMotionViewProps) {
  const { t } = useTranslation();
  return <Suspense fallback={<div role="status" className="p-3 text-[13px] text-muted-foreground">{t('visual_search.loading')}</div>}><Motion {...props} /></Suspense>;
}
