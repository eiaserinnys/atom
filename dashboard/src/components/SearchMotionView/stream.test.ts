import { describe, expect, test, vi } from 'vitest';
import { readSearchStream, SearchStreamInterruptedError, searchUrl } from './stream';

describe('Jev stream contract', () => {
  test('uses the dashboard API, scope and exhaustive continuation', () => {
    const url = new URL(searchUrl('장미 겨울나기', { rootNodeId: 'rose', exhaustive: true }), 'http://localhost');
    expect(url.pathname).toBe('/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: '장미 겨울나기', engine: 'jev', stream: '1', rootNodeId: 'rose', exhaustive: '1' });
  });
  test('decodes split UTF-8 and CRLF frames, ignores heartbeats, and requires done', async () => {
    const bytes = new TextEncoder().encode('event: run\r\ndata: {"query":"장미"}\r\n\r\n: ping\n\nevent: done\ndata: {"results":[]}\n\n');
    const body = new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 2) c.enqueue(bytes.slice(i, i + 2)); c.close(); } });
    const receive = vi.fn();
    await readSearchStream(body, receive, new AbortController().signal);
    expect(receive.mock.calls).toEqual([[{ event: 'run', data: { query: '장미' } }], [{ event: 'done', data: { results: [] } }]]);
    const incomplete = new ReadableStream({ start(c) { c.close(); } });
    await expect(readSearchStream(incomplete, receive, new AbortController().signal)).rejects.toThrow(SearchStreamInterruptedError);
  });
});
