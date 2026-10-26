import { lazy, Suspense } from 'react';
import type { SearchMotionViewProps } from './SearchMotionView';
import { useTranslation } from 'react-i18next';
import { PanelState } from '../PanelState';
import { Spinner } from '../Spinner';
const Motion = lazy(() => import('./SearchMotionView').then(module => ({ default: module.SearchMotionView })));
export function LazySearchMotionView(props: SearchMotionViewProps) {
  const { t } = useTranslation();
  return <Suspense fallback={<PanelState><Spinner label={t('common.loading')} /></PanelState>}><Motion {...props} /></Suspense>;
}
