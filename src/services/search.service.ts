import { getDb } from "../db/client.js";
import { searchByBm25 } from "../db/queries/search.js";
import type { SearchResult, SearchFilters } from "../shared/types.js";

const RELAXED_QUERY_MIN_TERMS = 4;
const RELAXED_QUERY_MAX_TERMS = 12;
const DOMAIN_FALLBACK_MAX_TERMS = 16;
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

const DOMAIN_SYNONYMS: Array<[RegExp, string[]]> = [
  [/(^treeview$|^tree-view$|트리뷰|트리\s*뷰)/i, ["tree", "TreeView", "layout", "responsive", "mobile"]],
  [/(^sse$|event|이벤트)/i, ["SSE", "event", "events", "reconnect", "refetch"]],
  [/(miss|lost|drop|놓침|누락)/i, ["missing", "dropped", "reconnect", "retry"]],
  [/(symlink|심링크|바로가기)/i, ["symlink", "canonical", "shortcut", "children"]],
  [/(move|moved|root|이동|루트)/i, ["move", "moves", "root_node_id", "parent", "batch_op"]],
  [/(mobile|responsive|layout|모바일|반응형|레이아웃)/i, ["mobile", "responsive", "layout", "small", "screen"]],
];

export async function searchCards(
  filters: SearchFilters
): Promise<SearchResult[]> {
  const strictResults = await searchByBm25(getDb(), filters);
  if (strictResults.length > 0 || filters.strategy === "strict") {
    return strictResults;
  }

  const fallbackQueries = buildSearchFallbackQueries(filters.query);
  for (const fallbackQuery of fallbackQueries) {
    const fallbackResults = await searchByBm25(getDb(), {
      ...filters,
      query: fallbackQuery,
      strategy: "strict",
    });

    if (fallbackResults.length > 0) {
      return fallbackResults;
    }
  }

  return strictResults;
}

export function buildSearchFallbackQueries(query: string): string[] {
  if (hasExplicitWebsearchSyntax(query)) return [];

  const queries: string[] = [];
  const relaxedQuery = buildRelaxedPlainQuery(query);
  const synonymQuery = buildDomainSynonymQuery(query);

  for (const candidate of [relaxedQuery, synonymQuery]) {
    if (!candidate || candidate === query || queries.includes(candidate)) continue;
    queries.push(candidate);
  }

  return queries;
}

export function buildRelaxedPlainQuery(query: string): string | null {
  if (hasExplicitWebsearchSyntax(query)) return null;

  const terms = extractPlainTerms(query, RELAXED_QUERY_MAX_TERMS);

  if (terms.length < RELAXED_QUERY_MIN_TERMS) return null;
  return terms.join(" OR ");
}

function buildDomainSynonymQuery(query: string): string | null {
  const terms = extractPlainTerms(query, DOMAIN_FALLBACK_MAX_TERMS);
  const expanded: string[] = [];

  for (const term of terms) {
    addSearchTerm(expanded, term);
  }

  for (const term of terms) {
    for (const synonym of getDomainSynonyms(term)) {
      addSearchTerm(expanded, synonym);
      if (expanded.length >= DOMAIN_FALLBACK_MAX_TERMS) break;
    }
    if (expanded.length >= DOMAIN_FALLBACK_MAX_TERMS) break;
  }

  if (expanded.length <= terms.length) return null;
  return expanded.join(" OR ");
}

function extractPlainTerms(query: string, maxTerms: number): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  const matches = query.match(/[\p{L}\p{N}_-]+/gu) ?? [];

  for (const raw of matches) {
    const key = raw.toLowerCase();
    if (key.length < 2 || STOP_WORDS.has(key) || seen.has(key)) continue;
    seen.add(key);
    addSearchTerm(terms, raw);
    if (terms.length >= maxTerms) break;
  }

  return terms;
}

function addSearchTerm(terms: string[], term: string): void {
  if (!terms.includes(term)) terms.push(term);
}

function getDomainSynonyms(term: string): string[] {
  return DOMAIN_SYNONYMS.flatMap(([pattern, synonyms]) =>
    pattern.test(term) ? synonyms : []
  );
}

function hasExplicitWebsearchSyntax(query: string): boolean {
  return /["()]/.test(query)
    || /\b(?:OR|AND)\b/.test(query)
    || /(^|\s)-\S/.test(query);
}
