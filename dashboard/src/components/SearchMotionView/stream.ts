export interface MotionEvent { event: string; data: Record<string, unknown> }
export interface SearchRequest { query: string; rootNodeId?: string; exhaustive?: boolean; requestId: number }
export function searchUrl(query: string, options: { rootNodeId?: string; exhaustive?: boolean } = {}) {
  const params = new URLSearchParams({ q: query, engine: 'jev', stream: '1' });
  if (options.rootNodeId) params.set('rootNodeId', options.rootNodeId);
  if (options.exhaustive) params.set('exhaustive', '1');
  return `${import.meta.env.VITE_API_BASE_URL ?? ''}/search?${params}`;
}

// Mirrors the published client's framing: UTF-8 chunks, CRLF, multiline data, four event kinds.
export async function readSearchStream(body: ReadableStream<Uint8Array>, receive: (event: MotionEvent) => void, signal: AbortSignal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  const cancel = () => { void reader.cancel(); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (!signal.aborted) {
      const chunk = await reader.read();
      if (signal.aborted) return;
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let split: number;
      while ((split = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + buffer.slice(split).match(/^\r?\n\r?\n/)![0].length);
        let event = '';
        const data: string[] = [];
        for (const line of frame.split(/\r?\n/)) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
        }
        if (!['run', 'step_started', 'step_completed', 'done'].includes(event)) continue;
        receive({ event, data: JSON.parse(data.join('\n')) });
        if (event === 'done') finished = true;
      }
      if (chunk.done) break;
    }
    if (!finished && !signal.aborted) throw new Error('검색 연결이 중단되었습니다. 다시 시도해 주세요.');
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}
