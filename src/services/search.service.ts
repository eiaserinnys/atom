import { getPool } from "../db/client.js";
import { searchByBm25 } from "../db/queries/search.js";
import type { SearchResult } from "../shared/types.js";

export async function searchCards(
  query: string,
  limit: number = 20,
  rootNodeId?: string
): Promise<SearchResult[]> {
  return searchByBm25(getPool(), query, limit, rootNodeId);
}
