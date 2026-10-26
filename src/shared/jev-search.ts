import type { CardType, SearchResult } from "./types.js";

export type JevSearchStatus = "complete" | "limited" | "cancelled" | "error";
export type JevSearchStage = "atom_outline" | "structure_noul" | "content_noul" | "selection" | "run_terminal" | "lexical_seed" | "hit_parent" | "sufficiency_noul" | "widen" | "deferred_scan";
export type JevAuditStage = "atom_outline" | "structure_noul" | "content_noul" | "lexical_seed" | "hit_parent" | "sufficiency_noul";
export type JevSearchAction = "queued" | "pruned" | "content_scored" | "selected" | "not_selected" | "alias" | "no_body" | "opened_by_hit" | "opened_root";
export type JevSearchStopReason = "sufficient" | "exhausted" | null;

export interface JevNoulQuestion {
  type: "noul";
  instructions: string;
  criteria: { true: string; false: string };
}
export interface JevMeaningPayload {
  state: string;
  model: "jev-latest";
  questions: Record<string, JevNoulQuestion>;
}

export interface JevMeaningResponse {
  model: string;
  answers: Record<string, { type?: string; noul?: number }>;
  usage: { input_tokens: number; output_tokens?: number };
}

export interface JevSearchContext {
  agent: string | null;
  project: string | null;
  task: string | null;
}

export interface JevSearchInput {
  query: string;
  root_node_id?: string | null;
  limit?: number;
  context?: Partial<JevSearchContext>;
  exhaustive?: boolean;
}

export interface JevSearchPolicyView {
  prompt_version: "v3";
  model: "jev-latest";
  summary_chars: number;
  structure_threshold: number;
  score_floor: number;
  relative_score_delta: number;
  max_results: number;
  batch_candidates: number;
  payload_max_chars: number;
  run_timeout_ms: number;
  max_candidates: number;
  max_concurrent_runs: number;
  seed_limit: number;
  seed_max_terms: number;
  sufficiency_threshold: number;
  max_jev_calls: number;
  max_parallel_jev_calls: number;
  defer_candidates: number;
}

export interface CandidateOccurrence {
  ref: string;
  node_id: string;
  card_id: string;
  card_type: CardType;
  is_symlink: boolean;
  title: string;
  summary: string | null;
  path: string[];
  path_node_ids: string[];
  traversal_depth: number;
  physical_parent_node_id: string | null;
  traversal_parent_ref: string | null;
  canonical_node_id: string | null;
  discovered_in_step_id: string;
  child_count: number | null;
  hop: number;
  origin: "lexical_seed" | "hit_parent" | "outline";
  hit_ref: string | null;
  lexical_rank?: number;
  match_snippet?: string;
}

export interface JevStepDecision {
  ref: string;
  question_key: string | null;
  score: number | null;
  action: JevSearchAction;
  reused_from_ref: string | null;
}

export interface JevSearchStep {
  id: string;
  seq: number;
  stage: JevSearchStage;
  hop: number;
  started_at: string;
  completed_at: string | null;
  call_id: string | null;
  candidate_refs: string[];
  decisions: JevStepDecision[];
  purpose?: "candidate_discovery" | "symlink_summary";
  parent_ref?: string | null;
  canonical_node_id?: string | null;
  selection_threshold?: number;
  selected_refs?: string[];
  terminal_status?: JevSearchStatus;
  terminal_code?: string | null;
  sufficiency_score?: number;
  sufficiency_threshold?: number;
  widen_reason?: "no_entry" | "frontier_empty";
  stop_reason?: JevSearchStopReason;
  deferred_refs?: string[];
}

export interface JevAuditCall {
  call_id: string;
  run_id: string;
  seq: number;
  stage: JevAuditStage;
  candidate_count: number;
  disposition: "completed" | "skipped" | "error";
  started_at: string;
  completed_at: string | null;
  latency_ms: number | null;
  usage: { input_tokens: number; output_tokens: number | null } | null;
  request: Record<string, unknown>;
  response: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
}

export interface JevSearchResponse {
  schema_version: 2;
  engine: "jev";
  run_id: string;
  query: string;
  root_node_id: string | null;
  exhaustive: boolean;
  status: JevSearchStatus;
  complete: boolean;
  stop_reason: JevSearchStopReason;
  started_at: string;
  completed_at: string;
  policy: JevSearchPolicyView;
  results: Array<SearchResult & { score: number; selected_from_step_id: string }>;
  trace: {
    candidates: CandidateOccurrence[];
    steps: JevSearchStep[];
    calls: JevAuditCall[];
  };
  error: { code: string; message: string } | null;
}

export type JevSearchEvent =
  | { event: "run"; data: Pick<JevSearchResponse, "schema_version" | "engine" | "run_id" | "query" | "root_node_id" | "exhaustive" | "started_at" | "policy"> }
  | { event: "step_started"; data: Pick<JevSearchStep, "id" | "seq" | "hop" | "stage" | "started_at" | "candidate_refs"> }
  | { event: "step_completed"; data: { step: JevSearchStep; candidates: CandidateOccurrence[]; call: JevAuditCall | null } }
  | { event: "done"; data: Pick<JevSearchResponse, "status" | "complete" | "stop_reason" | "completed_at" | "results" | "error"> };

export type JevSearchObserver = (event: JevSearchEvent) => void;

export interface JevSearchSummary {
  jev_calls: number;
  input_tokens: number;
  elapsed_ms: number;
  hops: number;
  candidates: number;
  selection_threshold: number | null;
}

export type JevSearchCompactResponse = Omit<JevSearchResponse, "trace"> & { summary: JevSearchSummary };
