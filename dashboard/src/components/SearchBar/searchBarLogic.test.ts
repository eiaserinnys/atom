import { describe, expect, test } from 'vitest';
import {
  buildSearchFilters,
  formatBreadcrumb,
  hasSearchFilters,
  snippetParts,
} from './searchBarLogic';

describe('search bar filter logic', () => {
  test('omits blank values and invalid dates from request filters', () => {
    expect(
      buildSearchFilters({
        currentNodeId: 'node-1',
        scopeToCurrentNode: true,
        cardType: '',
        tagsText: 'alpha, , beta',
        sourceType: '  ',
        updatedAfter: 'not-a-date',
        updatedBefore: '',
      })
    ).toEqual({
      rootNodeId: 'node-1',
      tags: ['alpha', 'beta'],
    });
  });

  test('formats node_path breadcrumbs', () => {
    expect(formatBreadcrumb(['project', 'atom', 'TODO'])).toBe('project / atom / TODO');
    expect(formatBreadcrumb([])).toBeNull();
  });

  test('detects active filters', () => {
    expect(hasSearchFilters({ tags: ['alpha'] })).toBe(true);
    expect(hasSearchFilters({})).toBe(false);
  });
});

describe('snippetParts', () => {
  test('cleans markdown blocks and preserves the server match emphasis', () => {
    expect(snippetParts('Steps to run before cutting a <b>release</b>.\n## Before tagging\n- Run the full test suite')).toEqual([
      { text: 'Steps to run before cutting a ', match: false },
      { text: 'release', match: true },
      { text: '. Before tagging Run the full test suite', match: false },
    ]);
  });

  test('removes inline links and backticks', () => {
    expect(snippetParts('Check `code` and [site](https://example.com).')).toEqual([
      { text: 'Check code and site.', match: false },
    ]);
  });

  test('removes table separator lines', () => {
    expect(snippetParts('| Name | Value |\n| --- | --- |\n| atom | **Ready** |')).toEqual([
      { text: 'Name Value atom Ready', match: false },
    ]);
  });

  test('returns one unmarked part when the snippet has no server emphasis', () => {
    expect(snippetParts('Plain snippet')).toEqual([{ text: 'Plain snippet', match: false }]);
  });
});
