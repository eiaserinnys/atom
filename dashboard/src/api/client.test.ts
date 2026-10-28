import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './client';
import { compileApi } from './compileApi';

type FetchMock = ReturnType<
  typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>
>;

function responseWithJson(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(typeof data === 'string' ? data : JSON.stringify(data)),
  } as unknown as Response;
}

function responseWithoutBody(status = 204): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockRejectedValue(new Error('json should not be called')),
    text: vi.fn().mockResolvedValue(''),
  } as unknown as Response;
}

function responseWithText(status: number, text: string): Response {
  return {
    ok: false,
    status,
    json: vi.fn(),
    text: vi.fn().mockResolvedValue(text),
  } as unknown as Response;
}

function installLocation(pathname: string, href = pathname) {
  vi.stubGlobal('window', {
    location: {
      pathname,
      href,
    },
  });
}

function getFetchInit(fetchMock: FetchMock, callIndex = 0): RequestInit {
  const init = fetchMock.mock.calls[callIndex]?.[1];
  if (!init) throw new Error('fetch was not called with RequestInit');
  return init;
}

describe('dashboard API client transport contracts', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    installLocation('/');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('adds JSON content type only when a body is present', async () => {
    fetchMock.mockResolvedValueOnce(responseWithoutBody());
    await api.deleteNode('node-1');

    expect(getFetchInit(fetchMock).headers).not.toHaveProperty('Content-Type');

    fetchMock.mockResolvedValueOnce(responseWithoutBody());
    await api.moveNode('node-1', { parent_node_id: null, before: 'node-0' });

    expect(getFetchInit(fetchMock, 1).headers).toHaveProperty(
      'Content-Type',
      'application/json'
    );
  });

  test('does not parse JSON for successful void responses', async () => {
    const response = responseWithoutBody();
    fetchMock.mockResolvedValueOnce(response);

    await api.deleteNode('node-1');

    expect(response.json).not.toHaveBeenCalled();
  });

  test('redirects non-root 401 responses and throws Unauthorized', async () => {
    installLocation('/cards/node-1', '/cards/node-1');
    fetchMock.mockResolvedValueOnce(responseWithText(401, 'nope'));

    await expect(api.getTree()).rejects.toThrow('Unauthorized');

    expect(window.location.href).toBe('/');
  });

  test('does not redirect root 401 responses', async () => {
    installLocation('/', 'unchanged');
    fetchMock.mockResolvedValueOnce(responseWithText(401, 'nope'));

    await expect(api.getTree()).rejects.toThrow('Unauthorized');

    expect(window.location.href).toBe('unchanged');
  });

  test('preserves non-ok error messages', async () => {
    fetchMock.mockResolvedValueOnce(responseWithText(500, 'broken'));

    await expect(api.getTree()).rejects.toThrow('API 500: broken');
  });

  test('unwraps the card from the PUT update response envelope', async () => {
    const card = {
      id: 'card-1',
      card_type: 'knowledge' as const,
      title: 'Updated title',
      content: 'Current body',
      references: [],
      tags: [],
      card_timestamp: '2026-10-26T00:00:00.000Z',
      content_timestamp: null,
      source_type: null,
      source_ref: null,
      version: 2,
      updated_at: '2026-10-26T00:00:00.000Z',
      created_by: null,
      updated_by: null,
    };
    fetchMock.mockResolvedValueOnce(responseWithJson({ card, conflict: false }));

    await expect(api.updateCard(card.id, { title: card.title })).resolves.toEqual(card);
  });

  test('serializes compile query options', async () => {
    fetchMock.mockResolvedValueOnce(responseWithJson({ markdown: '# title' }));

    await api.compile('node-1', {
      depth: Infinity,
      include_ids: true,
      titles_only: true,
      numbering: true,
      max_chars: 120,
      exclude_nodes: ['skip-1', 'skip-2'],
    });

    const requested = String(fetchMock.mock.calls[0]?.[0]);
    const url = new URL(requested, 'https://atom.local');

    expect(url.pathname).toBe('/tree/node-1/compile');
    expect(url.searchParams.get('depth')).toBe('Infinity');
    expect(url.searchParams.get('include_ids')).toBe('true');
    expect(url.searchParams.get('titles_only')).toBe('true');
    expect(url.searchParams.get('numbering')).toBe('true');
    expect(url.searchParams.get('max_chars')).toBe('120');
    expect(url.searchParams.get('exclude_nodes')).toBe('skip-1,skip-2');
  });

  test('serializes the section, contents and find API contracts', async () => {
    fetchMock.mockResolvedValue(responseWithJson({}));
    await compileApi.sections('node-1', Infinity, 60000);
    await compileApi.sectionsWithRefs('node-1', Infinity, 'cached', {}, 60000);
    await compileApi.contents(['card-1', 'card-2']);
    await compileApi.find('node-1', 5, '찾는 글');

    const sections = new URL(String(fetchMock.mock.calls[0]?.[0]), 'https://atom.local');
    expect(sections.pathname).toBe('/tree/node-1/compile/sections');
    expect(sections.searchParams.get('depth')).toBe('Infinity');
    expect(sections.searchParams.get('head_chars')).toBe('60000');
    expect(JSON.parse(getFetchInit(fetchMock, 1).body as string)).toEqual({ depth: null, resolveRefs: 'cached', credentials: {}, head_chars: 60000 });
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe('/tree/compile/contents');
    expect(JSON.parse(getFetchInit(fetchMock, 2).body as string)).toEqual({ card_ids: ['card-1', 'card-2'] });
    const find = new URL(String(fetchMock.mock.calls[3]?.[0]), 'https://atom.local');
    expect(find.pathname).toBe('/tree/node-1/compile/find');
    expect(find.searchParams.get('q')).toBe('찾는 글');
  });

  test('keeps text-only search URL compatible', async () => {
    fetchMock.mockResolvedValueOnce(responseWithJson([]));

    await api.search('plain text');

    const requested = String(fetchMock.mock.calls[0]?.[0]);
    const url = new URL(requested, 'https://atom.local');

    expect(url.pathname).toBe('/search');
    expect(url.searchParams.get('q')).toBe('plain text');
    expect([...url.searchParams.keys()]).toEqual(['q']);
  });

  test('serializes search filters only when values are present', async () => {
    fetchMock.mockResolvedValueOnce(responseWithJson([]));

    await api.search('filtered', {
      rootNodeId: 'node-1',
      card_type: 'knowledge',
      tags: ['alpha', 'beta'],
      source_type: 'web',
      updated_after: '2026-05-24T00:00:00.000Z',
      updated_before: '2026-05-25T00:00:00.000Z',
    });

    const requested = String(fetchMock.mock.calls[0]?.[0]);
    const url = new URL(requested, 'https://atom.local');

    expect(url.pathname).toBe('/search');
    expect(url.searchParams.get('q')).toBe('filtered');
    expect(url.searchParams.get('rootNodeId')).toBe('node-1');
    expect(url.searchParams.get('card_type')).toBe('knowledge');
    expect(url.searchParams.get('tags')).toBe('alpha,beta');
    expect(url.searchParams.get('source_type')).toBe('web');
    expect(url.searchParams.get('updated_after')).toBe('2026-05-24T00:00:00.000Z');
    expect(url.searchParams.get('updated_before')).toBe('2026-05-25T00:00:00.000Z');
    expect(url.searchParams.has('strategy')).toBe(false);
  });
});
