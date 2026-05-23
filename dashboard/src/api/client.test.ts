import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './client';

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
});
