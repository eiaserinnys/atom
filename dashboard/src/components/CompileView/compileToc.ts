import type { CompileSection } from '../../api/types';

export interface TocEntry {
  id: string;
  sectionIndex: number;
  headingIndex: number;
  text: string;
  level: number;
}

export const TOC_WIDTH = 200;
export const TOC_HEADING_ID_PREFIX = 'compile-heading-';

export function getTocHeadingId(index: number): string {
  return `${TOC_HEADING_ID_PREFIX}${index}`;
}

export function buildTocEntriesFromSections(sections: readonly CompileSection[]): TocEntry[] {
  const entries: TocEntry[] = [];
  for (const section of sections) {
    entries.push({ id: getTocHeadingId(entries.length), sectionIndex: section.index, headingIndex: -1, text: section.title, level: section.level });
    section.headings.forEach((heading, headingIndex) => {
      entries.push({ id: getTocHeadingId(entries.length), sectionIndex: section.index, headingIndex, text: heading.text, level: heading.level });
    });
  }
  return entries;
}

function normalizeHeading(text: string): string {
  return text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim().replace(/\s+/g, ' ');
}

export function findTocHeading(element: Element, section: CompileSection, headingIndex: number): HTMLHeadingElement | null {
  const heading = section.headings[headingIndex];
  if (!heading) return null;
  const text = normalizeHeading(heading.text);
  const previous = section.headings.slice(0, headingIndex).filter(item => normalizeHeading(item.text) === text).length;
  const headings = Array.from(element.querySelectorAll<HTMLHeadingElement>('h1,h2,h3,h4,h5,h6')).slice(1);
  return headings.filter(item => normalizeHeading(item.textContent ?? '') === text)[previous] ?? null;
}

export function getTocMinLevel(entries: readonly TocEntry[]): number {
  return Math.min(...entries.map((entry) => entry.level), 1);
}

export function getTocEntryPaddingLeft(entry: TocEntry, minLevel: number): number {
  return (entry.level - minLevel) * 12 + 8;
}
