// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import type { CompileSection } from '../../api/types';
import { buildTocEntriesFromSections, findTocHeading, getTocEntryPaddingLeft, getTocMinLevel } from './compileToc';

const section: CompileSection = {
  index: 0, node_id: 'node', card_id: 'card', card_version: 1, depth: 0, level: 1,
  heading: '# Root', title: 'Root', cycle: false, chars: 10,
  headings: [{ level: 2, text: '[Link](https://example.test)' }, { level: 2, text: 'Same' }, { level: 3, text: 'Same' }],
};

describe('compile TOC', () => {
  test('builds entries from the server headings and retains the existing indentation', () => {
    const entries = buildTocEntriesFromSections([section]);
    expect(entries.map(({ sectionIndex, headingIndex, text, level }) => [sectionIndex, headingIndex, text, level])).toEqual([
      [0, -1, 'Root', 1], [0, 0, '[Link](https://example.test)', 2], [0, 1, 'Same', 2], [0, 2, 'Same', 3],
    ]);
    expect(getTocMinLevel(entries)).toBe(1);
    expect(getTocEntryPaddingLeft(entries[3]!, 1)).toBe(32);
  });

  test('finds matching rendered headings by text and duplicate order, ignoring extra headings', () => {
    const element = document.createElement('div');
    element.innerHTML = '<h1>Root</h1><h2>Unlisted</h2><h2> Link </h2><h2>Same</h2><h3>Same</h3>';
    expect(findTocHeading(element, section, 0)?.textContent).toBe(' Link ');
    expect(findTocHeading(element, section, 2)?.tagName).toBe('H3');
    expect(findTocHeading(element, { ...section, headings: [{ level: 2, text: 'Missing' }] }, 0)).toBeNull();
  });
});
