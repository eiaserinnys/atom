import { useEffect, useRef, useState } from 'react';
import { createMotionPlayer, type MotionPlayer } from './player.js';
import { readSearchStream, searchUrl, type SearchRequest } from './stream';
import type { MotionNode } from './types';
import sampleUrl from './samples.json?url';
import markup from './motion.html?raw';
import './motion.css';

// React must preserve the DOM managed by the canvas player across parent renders.
const motionMarkup = { __html: markup };

export interface SearchMotionViewProps {
  request: SearchRequest | null;
  onSummary?(summary: string): void;
  onSelectNode(nodeId: string, verdict: MotionNode): void;
  onResults(nodes: MotionNode[]): void;
}

export function SearchMotionView({ request, onSelectNode, onResults, onSummary }: SearchMotionViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<MotionPlayer | null>(null);
  const active = useRef<AbortController | null>(null);
  const callbacks = useRef({ onSelectNode, onResults, onSummary });
  const requestRef = useRef(request);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const lastQuery = useRef('');
  const startRef = useRef<(query: string, exhaustive?: boolean) => void>(() => {});

  useEffect(() => { callbacks.current = { onSelectNode, onResults, onSummary }; requestRef.current = request; });
  useEffect(() => {
    let instance: MotionPlayer | null = null;
    const controller = new AbortController();
    void fetch(sampleUrl, { signal: controller.signal }).then(response => { if (!response.ok) throw new Error('표본을 불러오지 못했습니다.'); return response.json(); }).then(samples => {
    if (controller.signal.aborted) return;
    instance = createMotionPlayer(host.current!, {
      onSummary: text => callbacks.current.onSummary?.(text),
      onSelect: (node) => { if (node.nodeId) callbacks.current.onSelectNode(node.nodeId, node); },
      onResults: (nodes) => callbacks.current.onResults(nodes),
      onMore: (query) => startRef.current(query, true),
      onCancel: () => { active.current?.abort(); setError(''); },
    }, samples);
    player.current = instance; setReady(true);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '표본을 불러오지 못했습니다.'); });
    return () => { controller.abort(); active.current?.abort(); instance?.dispose(); player.current = null; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const start = async (query: string, exhaustive = false) => {
      lastQuery.current = query;
      active.current?.abort();
      const controller = new AbortController();
      active.current = controller;
      setError('');
      player.current!.begin(query);
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
    startRef.current = (query, exhaustive) => { void start(query, exhaustive); };
    if (request) void start(request.query, request.exhaustive);
    return () => active.current?.abort();
  }, [request, ready]);

  return <div className="h-full min-h-0 flex flex-col">
    {error && <div role="alert" className="border-b border-border px-3 py-2 text-[13px] text-[var(--danger)]">{error} <button className="underline" onClick={() => startRef.current(lastQuery.current)}>다시 시도</button></div>}
    <div className="search-motion flex-1" ref={host} dangerouslySetInnerHTML={motionMarkup} />
  </div>;
}
