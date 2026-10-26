import { useContext, useEffect, useRef, useState } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { createMotionPlayer, type MotionPlayer } from './player.js';
import { readSearchStream, searchUrl, type SearchRequest } from './stream';
import type { MotionNode } from './types';
import sampleUrl from './samples.json?url';
import markup from './motion.html?raw';
import './motion.css';
import { useTranslation } from 'react-i18next';
import { runVisualOperation } from './operation-runner';
import type { OperationSnapshot } from './operation-types';

// React must preserve the DOM managed by the canvas player across parent renders.
const motionMarkup = { __html: markup };

export interface SearchMotionViewProps {
  request: SearchRequest | null;
  onSummary?(summary: string): void;
  onSelectNode(nodeId: string | null, verdict: MotionNode | null): void;
  onResults(nodes: MotionNode[]): void;
  onOpenInTree?(nodeId: string): void;
}

export function SearchMotionView({ request, onSelectNode, onResults, onSummary, onOpenInTree }: SearchMotionViewProps) {
  const { t } = useTranslation();
  const queryClient = useContext(QueryClientContext);
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<MotionPlayer | null>(null);
  const active = useRef<AbortController | null>(null);
  const callbacks = useRef({ onSelectNode, onResults, onSummary, onOpenInTree, t });
  const requestRef = useRef(request);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const lastQuery = useRef('');
  const startRef = useRef<(query: string, exhaustive?: boolean, resume?: boolean) => void>(() => {});
  const operationRef = useRef<(kind: 'expand' | 'evaluate' | 'query', snapshot: OperationSnapshot, retryId?: string) => void>(() => {});
  const retryRef = useRef<() => void>(() => {});
  useEffect(() => queryClient?.getQueryCache().subscribe(event => {
    if (['tree', 'children', 'node'].includes(String(event.query.queryKey[0]))) player.current?.refreshPaths?.();
  }), [queryClient]);

  useEffect(() => { callbacks.current = { onSelectNode, onResults, onSummary, onOpenInTree, t }; requestRef.current = request; });
  useEffect(() => {
    host.current?.querySelectorAll<HTMLElement>('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n!); });
    host.current?.querySelectorAll<HTMLElement>('[data-i18n-label]').forEach(node => { node.setAttribute('aria-label', t(node.dataset.i18nLabel!)); });
  }, [t, ready]);
  useEffect(() => {
    let instance: MotionPlayer | null = null;
    const controller = new AbortController();
    void fetch(sampleUrl, { signal: controller.signal }).then(response => { if (!response.ok) throw new Error('표본을 불러오지 못했습니다.'); return response.json(); }).then(samples => {
    if (controller.signal.aborted) return;
    instance = createMotionPlayer(host.current!, {
      getCachedTreeNodes: () => queryClient?.getQueryCache().getAll()
        .filter(query => ['tree', 'children', 'node'].includes(String(query.queryKey[0])))
        .flatMap(query => Array.isArray(query.state.data) ? query.state.data : query.state.data ? [query.state.data] : []) ?? [],
      onSummary: text => callbacks.current.onSummary?.(text),
      onSelect: (node) => { if (!node || node.nodeId) callbacks.current.onSelectNode(node?.nodeId ?? null, node); },
      onResults: (nodes) => callbacks.current.onResults(nodes),
      onMore: (query, snapshot) => snapshot.continueSearch ? startRef.current(query, true, true) : operationRef.current('query', snapshot),
      onOperationRequest: (kind, snapshot) => operationRef.current(kind, snapshot),
      onOpenInTree: nodeId => callbacks.current.onOpenInTree?.(nodeId),
      translate: (key, values) => callbacks.current.t(key, values ?? {}),
      onCancel: () => { active.current?.abort(); setError(''); },
    }, samples);
    player.current = instance; setReady(true);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '표본을 불러오지 못했습니다.'); });
    return () => { controller.abort(); active.current?.abort(); instance?.dispose(); player.current = null; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    operationRef.current = (kind, snapshot, retryId) => {
      active.current?.abort();
      const controller = new AbortController(); active.current = controller; setError('');
      const retry = retryId ? snapshot.operations.find(op => op.id === retryId) : undefined;
      void runVisualOperation(player.current!, kind, snapshot, controller.signal, undefined, retry).then(result => {
        if (!result || controller.signal.aborted) return;
        setError(callbacks.current.t('visual_search.error', { code: result.code }));
        retryRef.current = () => operationRef.current(kind, player.current!.getSnapshot(), result.retry ?? undefined);
      });
    };
    const start = async (query: string, exhaustive = false, resume = false) => {
      lastQuery.current = query;
      active.current?.abort();
      const controller = new AbortController();
      active.current = controller;
      setError('');
      player.current!.begin(query, { resume });
      retryRef.current = () => startRef.current(query, exhaustive, resume);
      try {
        const response = await fetch(searchUrl(query, { rootNodeId: requestRef.current?.rootNodeId, exhaustive }), {
          credentials: 'include', cache: 'no-store', headers: { Accept: 'text/event-stream' }, signal: controller.signal,
        });
        if (!response.ok) throw new Error(response.status === 401 ? '로그인이 필요합니다.' : response.status === 403 ? '검색에 접근할 수 없습니다.' : response.status === 429 ? '검색이 많습니다. 잠시 뒤 다시 시도해 주세요.' : '검색을 사용할 수 없습니다. 다시 시도해 주세요.');
        if (!response.body) throw new Error('검색 스트림을 열 수 없습니다.');
        await readSearchStream(response.body, event => {
          if (!controller.signal.aborted) player.current?.receive(event);
        }, controller.signal);
      } catch (cause) {
        if (controller.signal.aborted) return;
        const message = cause instanceof Error ? cause.message : '검색을 완료하지 못했습니다.';
        setError(message); player.current?.error(message);
      }
    };
    startRef.current = (query, exhaustive, resume) => { void start(query, exhaustive, resume); };
    if (request) void start(request.query, request.exhaustive);
    return () => active.current?.abort();
  }, [request, ready]);

  return <div className="h-full min-h-0 flex flex-col">
    {error && <div role="alert" className="border-b border-border px-3 py-2 text-sm text-[var(--danger)]">{error} <button className="underline" onClick={() => retryRef.current()}>{t('visual_search.retry')}</button></div>}
    <div className="search-motion flex-1" ref={host} dangerouslySetInnerHTML={motionMarkup} />
  </div>;
}
