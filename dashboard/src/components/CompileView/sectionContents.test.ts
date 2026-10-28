import { describe, expect, test, vi } from 'vitest';
import type { CompileSection } from '../../api/types';
import { createSectionContentsStore } from './sectionContents';

function section(index: number, chars = 2000): CompileSection {
  return {
    index, node_id: `node-${index}`, card_id: `card-${index}`, card_version: 1,
    depth: 1, level: 2, heading: `## ${index}`, title: `${index}`,
    cycle: false, chars, headings: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('section content requests', () => {
  test('limits batch size and concurrency, then uses the newest range', async () => {
    const sections = Array.from({ length: 201 }, (_, i) => section(i));
    const requests: { ids: string[]; completion: ReturnType<typeof deferred<Record<string, { version: number; content: string | null }>>> }[] = [];
    const fetch = vi.fn((ids: string[]) => {
      const completion = deferred<Record<string, { version: number; content: string | null }>>();
      requests.push({ ids, completion });
      return completion.promise;
    });
    const store = createSectionContentsStore(fetch, () => {});
    store.setSections(sections);
    store.request(sections.map(item => item.index));
    expect(requests.map(item => item.ids.length)).toEqual([100, 100]);
    store.request([200]);
    requests[0]!.completion.resolve(Object.fromEntries(requests[0]!.ids.map(id => [id, { version: 1, content: id }])));
    await vi.waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[2]!.ids).toEqual(['card-200']);
    expect(store.get(sections[0]!)).toBe('card-0');
  });

  test('caps characters per batch and refetches when the card version changes', async () => {
    const a = section(0, 170000);
    const b = section(1, 170000);
    const fetch = vi.fn(async (ids: string[]) => Object.fromEntries(ids.map(id => [id, { version: 1, content: id }])));
    const store = createSectionContentsStore(fetch, () => {});
    store.setSections([a, b]);
    store.request([0, 1]);
    await vi.waitFor(() => expect(store.get(b)).toBe('card-1'));
    expect(fetch.mock.calls.map(call => call[0])).toEqual([['card-0'], ['card-1']]);
    const changed = { ...a, card_version: 2 };
    expect(store.get(changed)).toBeUndefined();
    store.setSections([changed]);
    fetch.mockResolvedValueOnce({ 'card-0': { version: 2, content: 'updated' } });
    store.request([0]);
    await vi.waitFor(() => expect(store.get(changed)).toBe('updated'));
  });
});
