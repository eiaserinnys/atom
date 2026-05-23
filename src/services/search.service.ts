import { getDb } from "../db/client.js";
import { searchByBm25 } from "../db/queries/search.js";
import type { SearchResult, SearchFilters } from "../shared/types.js";

const RELAXED_QUERY_MIN_TERMS = 4;
const RELAXED_QUERY_MAX_TERMS = 12;
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "what",
  "when",
  "where",
  "which",
  "with",
]);

export async function searchCards(
  filters: SearchFilters
): Promise<SearchResult[]> {
  const strictResults = await searchByBm25(getDb(), filters);
  if (strictResults.length > 0 || filters.strategy === "strict") {
    return strictResults;
  }

  const relaxedQuery = buildRelaxedPlainQuery(filters.query);
  if (!relaxedQuery) return strictResults;

  return searchByBm25(getDb(), {
    ...filters,
    query: relaxedQuery,
    strategy: "strict",
  });
}

export function buildRelaxedPlainQuery(query: string): string | null {
  if (hasExplicitWebsearchSyntax(query)) return null;

  const terms: string[] = [];
  const seen = new Set<string>();
  const matches = query.match(/[\p{L}\p{N}_]+/gu) ?? [];

  for (const raw of matches) {
    const key = raw.toLowerCase();
    if (key.length < 2 || STOP_WORDS.has(key) || seen.has(key)) continue;
    seen.add(key);
    terms.push(raw);
    if (terms.length >= RELAXED_QUERY_MAX_TERMS) break;
  }

  if (terms.length < RELAXED_QUERY_MIN_TERMS) return null;
  return terms.join(" OR ");
}

function hasExplicitWebsearchSyntax(query: string): boolean {
  return /["()]/.test(query)
    || /\b(?:OR|AND)\b/.test(query)
    || /(^|\s)-\S/.test(query);
}
