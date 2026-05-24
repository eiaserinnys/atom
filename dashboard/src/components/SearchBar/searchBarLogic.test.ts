import { describe, expect, test } from 'vitest';
import {
  buildSearchFilters,
  formatBreadcrumb,
  hasSearchFilters,
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
