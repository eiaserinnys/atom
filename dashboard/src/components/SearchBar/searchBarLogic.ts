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
