export interface TocEntry {
  id: string;
  text: string;
  level: number;
}

export interface HeadingLike {
  tagName: string;
  textContent: string | null;
}

export const TOC_WIDTH = 200;
export const TOC_HEADING_ID_PREFIX = 'compile-heading-';

export function getTocHeadingId(index: number): string {
  return `${TOC_HEADING_ID_PREFIX}${index}`;
}

export function buildTocEntriesFromHeadings(headings: readonly HeadingLike[]): TocEntry[] {
  return headings.map((heading, index) => ({
    id: getTocHeadingId(index),
    text: heading.textContent ?? '',
    level: parseInt(heading.tagName[1]!),
  }));
}

export function getTocMinLevel(entries: readonly TocEntry[]): number {
  return Math.min(...entries.map((entry) => entry.level), 1);
}

export function getTocEntryPaddingLeft(entry: TocEntry, minLevel: number): number {
  return (entry.level - minLevel) * 12 + 8;
}
