import { useContext, useEffect, useRef, useState } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { createMotionPlayer, type ExplorationRecord, type MotionPlayer } from './player.js';
import { readSearchStream, SearchStreamInterruptedError, searchUrl, type SearchRequest } from './stream';
import type { MotionNode } from './types';
import { Search } from 'lucide-react';
import { PanelState } from '../PanelState';
import markup from './motion.html?raw';
import './motion.css';
import { useTranslation } from 'react-i18next';
import { runVisualOperation } from './operation-runner';
import type { OperationSnapshot } from './operation-types';

// React must preserve the DOM managed by the canvas player across parent renders.
const motionMarkup = { __html: markup };

export interface SearchMotionViewProps {
  explorationState?: { current: { requestId: number; record: ExplorationRecord } | null };
  request: SearchRequest | null;
  onSummary?(summary: string): void;
  onSelectNode(nodeId: string | null, verdict: MotionNode | null): void;
  onResults(nodes: MotionNode[]): void;
  onOpenInTree?(nodeId: string): void;
}

export function SearchMotionView({ request, onSelectNode, onResults, onSummary, onOpenInTree, explorationState }: SearchMotionViewProps) {
  const { t } = useTranslation();
  const queryClient = useContext(QueryClientContext);
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<MotionPlayer | null>(null);
  const active = useRef<AbortController | null>(null);
  const callbacks = useRef({ onSelectNode, onResults, onSummary, onOpenInTree, t });
  const requestRef = useRef(request);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'active' | 'unconfigured'>(request ? 'active' : 'idle');
  const lastQuery = useRef('');
  const startRef = useRef<(query: string, exhaustive?: boolean, resume?: boolean) => void>(() => {});
  const operationRef = useRef<(kind: 'expand' | 'evaluate' | 'query', snapshot: OperationSnapshot, retryId?: string) => void>(() => {});
  const retryRef = useRef<() => void>(() => {});
  useEffect(() => queryClient?.getQueryCache().subscribe(event => {
    if (event.type === 'updated' && event.action.type === 'success'
      && ['tree', 'children', 'node'].includes(String(event.query.queryKey[0]))) player.current?.refreshPaths?.();
  }), [queryClient]);

  useEffect(() => { callbacks.current = { onSelectNode, onResults, onSummary, onOpenInTree, t }; requestRef.current = request; });
  useEffect(() => {
    host.current?.querySelectorAll<HTMLElement>('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n!); });
    host.current?.querySelectorAll<HTMLElement>('[data-i18n-label]').forEach(node => { node.setAttribute('aria-label', t(node.dataset.i18nLabel!)); });
    host.current?.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach(node => { node.setAttribute('title', t(node.dataset.i18nTitle!)); });
    host.current?.querySelectorAll<HTMLElement>('[data-i18n-roledescription]').forEach(node => { node.setAttribute('aria-roledescription', t(node.dataset.i18nRoledescription!)); });
  }, [t, ready]);
  useEffect(() => {
    let instance: MotionPlayer | null = null;
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
    });
    player.current = instance; setReady(true);
    return () => {
      if (instance && explorationState && requestRef.current) explorationState.current = { requestId: requestRef.current.requestId, record: instance.getRecord() };
      active.current?.abort(); instance?.dispose(); player.current = null;
    };
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
      setPhase('active');
      player.current!.begin(query, { resume });
      retryRef.current = () => startRef.current(query, exhaustive, resume);
      try {
        const response = await fetch(searchUrl(query, { rootNodeId: requestRef.current?.rootNodeId, exhaustive }), {
          credentials: 'include', cache: 'no-store', headers: { Accept: 'text/event-stream' }, signal: controller.signal,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          if (response.status === 503 && body?.error?.code === 'JEV_NOT_CONFIGURED') {
            setPhase('unconfigured'); player.current?.error(''); callbacks.current.onResults([]); callbacks.current.onSummary?.('');
            return;
          }
          throw new Error(callbacks.current.t(`visual_search.${response.status === 401 ? 'err_auth' : response.status === 403 ? 'err_forbidden' : response.status === 429 ? 'err_busy' : 'err_failed'}`));
        }
        if (!response.body) throw new Error(callbacks.current.t('visual_search.err_failed'));
        await readSearchStream(response.body, event => {
          if (!controller.signal.aborted) player.current?.receive(event);
        }, controller.signal);
      } catch (cause) {
        if (controller.signal.aborted) return;
        const message = cause instanceof SearchStreamInterruptedError ? callbacks.current.t('visual_search.err_interrupted') : cause instanceof Error ? cause.message : callbacks.current.t('visual_search.err_failed');
        setError(message); player.current?.error(message);
      }
    };
    startRef.current = (query, exhaustive, resume) => { void start(query, exhaustive, resume); };
    const saved = explorationState?.current;
    if (request && saved?.requestId === request.requestId && player.current!.restoreRecord(saved.record)) {
      setPhase('active');
      const failed = player.current!.getSnapshot().operations.at(-1);
      if (failed?.status === 'failed') {
        setError(callbacks.current.t('visual_search.error', { code: failed.errorCode }));
        retryRef.current = () => operationRef.current(failed.kind === 'evaluate' ? 'evaluate' : failed.fromCardId ? 'expand' : 'query', player.current!.getSnapshot(), failed.id);
      }
    } else if (request) void start(request.query, request.exhaustive);
    return () => active.current?.abort();
  }, [request, ready]);

  return <div className="h-full min-h-0 flex flex-col">
    {error && <div role="alert" className="border-b border-border px-3 py-2 text-sm text-[var(--danger)]">{error} <button className="underline" onClick={() => retryRef.current()}>{t('visual_search.retry')}</button></div>}
    {phase === 'idle' && <div data-search-phase="idle" className="flex-1 min-h-0 flex"><PanelState><Search className="w-5 h-5 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" /></PanelState></div>}
    {phase === 'unconfigured' && <div data-search-phase="unconfigured" className="flex-1 min-h-0 flex"><PanelState><p className="text-sm text-foreground">{t('visual_search.unconfigured')}</p><p className="text-[13px] text-muted-foreground break-keep text-balance">{t('visual_search.unconfigured_hint')}</p></PanelState></div>}
    <div className="search-motion flex-1" hidden={phase !== 'active'} ref={host} dangerouslySetInnerHTML={motionMarkup} />
  </div>;
}
