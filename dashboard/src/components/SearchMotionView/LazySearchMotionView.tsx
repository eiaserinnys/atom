import { lazy, Suspense } from 'react';
import type { SearchMotionViewProps } from './SearchMotionView';
const Motion = lazy(() => import('./SearchMotionView').then(module => ({ default: module.SearchMotionView })));
export function LazySearchMotionView(props: SearchMotionViewProps) {
  return <Suspense fallback={<div role="status" className="p-3 text-[13px] text-muted-foreground">검색 모션 불러오는 중…</div>}><Motion {...props} /></Suspense>;
}
