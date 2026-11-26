import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { TreeNodeData } from './client';
import { api } from './client';
import { treeApi } from './treeApi';
import { fetchChildrenWithCounts, fetchFullStructureTree, fetchRootsWithChildren } from './treeQueries';

vi.mock('./client', () => ({
  api: {
    getTree: vi.fn(),
    listChildren: vi.fn(),
  },
}));
vi.mock('./treeApi', () => ({
  treeApi: {
    getOutlineChildCounts: vi.fn(),
  },
}));

function node(id: string, isSymlink = false): TreeNodeData {
  return {
    id,
    card_id: `card-${id}`,
    parent_node_id: 'parent',
    position: 0,
    is_symlink: isSymlink,
    created_at: '2026-01-01T00:00:00Z',
    journal_limit: null,
    card: {
      id: `card-${id}`,
      card_type: 'knowledge',
      title: id,
      content: null,
      references: [],
      tags: [],
      card_timestamp: '2026-01-01T00:00:00Z',
      content_timestamp: null,
      source_type: null,
      source_ref: null,
      version: 1,
      updated_at: '2026-01-01T00:00:00Z',
      created_by: null,
      updated_by: null,
    },
  };
}

describe('fetchChildrenWithCounts', () => {
  beforeEach(() => vi.clearAllMocks());

  test('attaches outline counts to normal children and leaves symlinks unknown', async () => {
    const knowledge = node('knowledge');
    const symlink = node('symlink', true);
    vi.mocked(api.listChildren).mockResolvedValue([knowledge, symlink]);
    vi.mocked(treeApi.getOutlineChildCounts).mockResolvedValue({
      nodes: [
        { id: 'knowledge', child_count: 3 },
        { id: 'symlink', child_count: 0 },
      ],
    });

    const result = await fetchChildrenWithCounts('parent');

    expect(result[0]?.child_count).toBe(3);
    expect(result[1]).toBe(symlink);
    expect(result[1]?.child_count).toBeUndefined();
  });

  test('returns the original list when the optional outline request fails', async () => {
    const children = [node('knowledge')];
    vi.mocked(api.listChildren).mockResolvedValue(children);
    vi.mocked(treeApi.getOutlineChildCounts).mockRejectedValue(new Error('outline unavailable'));

    await expect(fetchChildrenWithCounts('parent')).resolves.toBe(children);
  });
});

describe('a children listing that now answers 404 for a deleted node', () => {
  const notFound = new Error('API 404: {"error":"Node not found: gone"}');

  beforeEach(() => vi.clearAllMocks());

  test('keeps the root tree loading with an empty child list for that node', async () => {
    const gone = node('gone');
    vi.mocked(api.getTree).mockResolvedValue([gone]);
    vi.mocked(api.listChildren).mockRejectedValue(notFound);
    vi.mocked(treeApi.getOutlineChildCounts).mockRejectedValue(notFound);

    await expect(fetchRootsWithChildren()).resolves.toEqual([{ ...gone, children: [] }]);
  });

  test('keeps the structure tree loading with an empty child list for that node', async () => {
    const gone = { ...node('gone'), card: { ...node('gone').card, card_type: 'structure' as const } };
    vi.mocked(api.getTree).mockResolvedValue([gone]);
    vi.mocked(api.listChildren).mockRejectedValue(notFound);

    await expect(fetchFullStructureTree()).resolves.toEqual([{ ...gone, children: [] }]);
  });

  test('lets a lazily expanded node see the error so its error icon shows', async () => {
    vi.mocked(api.listChildren).mockRejectedValue(notFound);
    vi.mocked(treeApi.getOutlineChildCounts).mockRejectedValue(notFound);

    await expect(fetchChildrenWithCounts('gone')).rejects.toBe(notFound);
  });
});
