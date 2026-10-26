import type { JevAuditCall, JevSearchContext } from "./jev-search.js";

export interface JevEvaluationInput {
  query: string;
  context?: Partial<JevSearchContext>;
  card_ids: string[];
}

export type JevEvaluationSkipReason = "CARD_NOT_FOUND" | "NO_BODY" | "NO_CANONICAL_NODE";

export interface JevEvaluationResponse {
  evaluation_id: string;
  query: string;
  model: "jev-latest";
  results: Array<{
    card_id: string;
    node_id: string;
    card_version: number;
    score: number;
    call_id: string;
    question_key: string;
  }>;
  skipped: Array<{ card_id: string; reason: JevEvaluationSkipReason }>;
  audit: { calls: JevAuditCall[] };
}
