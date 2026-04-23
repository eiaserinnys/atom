import { getDb } from "../db/client.js";
import { searchByBm25 } from "../db/queries/search.js";
import type { SearchResult, SearchFilters } from "../shared/types.js";

export async function searchCards(
  filters: SearchFilters
): Promise<SearchResult[]> {
  return searchByBm25(getDb(), filters);
}
