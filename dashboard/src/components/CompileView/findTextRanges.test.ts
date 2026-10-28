// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { findTextRanges } from './findTextRanges';

describe('rendered find ranges', () => {
  test('finds case-insensitive matches across text nodes without overlapping', () => {
    const element = document.createElement('div');
    element.innerHTML = '<span>Al</span><em>pha</em> alpha';
    const ranges = findTextRanges(element, 'alpha');
    expect(ranges.map(range => range.toString())).toEqual(['Alpha', 'alpha']);
    expect(ranges[0]!.startContainer.textContent).toBe('Al');
    expect(ranges[0]!.endContainer.textContent).toBe('pha');
  });
});
