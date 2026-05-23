import { describe, expect, test } from 'vitest';
import {
  buildTocEntriesFromHeadings,
  getTocEntryPaddingLeft,
  getTocMinLevel,
} from './compileToc';

describe('compile TOC logic', () => {
  test('builds entries with the existing generated id, text, and heading level rules', () => {
    const entries = buildTocEntriesFromHeadings([
      { tagName: 'H2', textContent: 'Intro' },
      { tagName: 'H4', textContent: null },
      { tagName: 'H3', textContent: 'Details' },
    ]);

    expect(entries).toEqual([
      { id: 'compile-heading-0', text: 'Intro', level: 2 },
      { id: 'compile-heading-1', text: '', level: 4 },
      { id: 'compile-heading-2', text: 'Details', level: 3 },
    ]);
  });

  test('preserves the current min-level formula that is anchored at level 1', () => {
    const entries = buildTocEntriesFromHeadings([
      { tagName: 'H2', textContent: 'Intro' },
      { tagName: 'H4', textContent: 'Deep' },
    ]);

    expect(getTocMinLevel(entries)).toBe(1);
    expect(getTocMinLevel([])).toBe(1);
    expect(getTocEntryPaddingLeft(entries[0]!, 1)).toBe(20);
    expect(getTocEntryPaddingLeft(entries[1]!, 1)).toBe(44);
  });
});
