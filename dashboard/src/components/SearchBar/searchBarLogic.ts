import type { SearchFilters } from '../../api/types';

export type SearchCardTypeFilter = '' | 'structure' | 'knowledge';

export interface SearchFilterDraft {
  currentNodeId?: string | null;
  scopeToCurrentNode: boolean;
  cardType: SearchCardTypeFilter;
  tagsText: string;
  sourceType: string;
  updatedAfter: string;
  updatedBefore: string;
}

export function buildSearchFilters(draft: SearchFilterDraft): SearchFilters {
  const filters: SearchFilters = {};
  const tags = parseTags(draft.tagsText);
  const updatedAfter = toIsoTimestamp(draft.updatedAfter);
  const updatedBefore = toIsoTimestamp(draft.updatedBefore);
  const sourceType = draft.sourceType.trim();

  if (draft.scopeToCurrentNode && draft.currentNodeId) {
    filters.rootNodeId = draft.currentNodeId;
  }
  if (draft.cardType) filters.card_type = draft.cardType;
  if (tags.length > 0) filters.tags = tags;
  if (sourceType) filters.source_type = sourceType;
  if (updatedAfter) filters.updated_after = updatedAfter;
  if (updatedBefore) filters.updated_before = updatedBefore;

  return filters;
}

export function hasSearchFilters(filters: SearchFilters): boolean {
  return Object.values(filters).some((value) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value)
  );
}

export function formatBreadcrumb(nodePath?: string[]): string | null {
  if (!nodePath || nodePath.length === 0) return null;
  return nodePath.join(' / ');
}

export function snippetParts(snippet: string): { text: string; match: boolean }[] {
  const rawCleaned = snippet
    .replace(/<b>/g, '\u0001')
    .replace(/<\/b>/g, '\u0002')
    .split('\n')
    .map((line) => {
      if (/^\s*(?:```|~~~|\|?\s*:?-{3,})/.test(line)) return '';
      return line
        .replace(/^\s*#{1,6}\s+/, '')
        .replace(/^\s*>\s?/, '')
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
        .replace(/^\s*\|/, '')
        .replace(/\|\s*$/, '')
        .replace(/\s*\|\s*/g, ' ');
    })
    .join(' ')
    .replace(/\*\*|__|`/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  const cleaned = formatJsonStringArray(rawCleaned) ?? rawCleaned;

  const parts: { text: string; match: boolean }[] = [];
  let match = false;
  // eslint-disable-next-line no-control-regex -- Control characters delimit internal search match markers.
  for (const text of cleaned.split(/(\u0001|\u0002)/)) {
    if (text === '\u0001') {
      match = true;
    } else if (text === '\u0002') {
      match = false;
    } else if (text) {
      parts.push({ text, match });
    }
  }
  return parts;
}

function formatJsonStringArray(value: string): string | null {
  const markerValues: string[] = [];
  // eslint-disable-next-line no-control-regex -- Control characters delimit internal search match markers.
  const json = value.replace(/[\u0001\u0002]/g, (marker) => {
    const placeholder = `\uE000${markerValues.length}\uE001`;
    markerValues.push(marker);
    return placeholder;
  });

  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) return null;
    return parsed.map((item: string) => item.replace(/\uE000(\d+)\uE001/g, (_match, index: string) => markerValues[Number(index)] ?? ''))
      .join(', ');
  } catch {
    return null;
  }
}

function parseTags(tagsText: string): string[] {
  const tags: string[] = [];
  for (const tag of tagsText.split(',')) {
    const trimmed = tag.trim();
    if (trimmed && !tags.includes(trimmed)) tags.push(trimmed);
  }
  return tags;
}

function toIsoTimestamp(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}
