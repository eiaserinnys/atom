import type { JevSearchPolicyView } from "../../shared/jev-search.js";
import type { JevSearchContext, JevSearchInput } from "../../shared/jev-search.js";
import { normalizeContext, normalizeQuery } from "./prompts.js";

export interface JevSearchPolicy {
  promptVersion: "v3";
  model: "jev-latest";
  summaryChars: number;
  structureThreshold: number;
  scoreFloor: number;
  relativeScoreDelta: number;
  maxResults: number;
  batchCandidates: number;
  payloadMaxChars: number;
  runTimeoutMs: number;
  maxCandidates: number;
  maxConcurrentRuns: number;
  seedLimit: number;
  seedMaxTerms: number;
  sufficiencyThreshold: number;
  maxJevCalls: number;
  maxParallelJevCalls: number;
  deferCandidates: number;
}

export const JEV_SEARCH_POLICY: JevSearchPolicy = {
  promptVersion: "v3",
  model: "jev-latest",
  summaryChars: 200,
  structureThreshold: 0.5,
  scoreFloor: 0.3,
  relativeScoreDelta: 0.1,
  maxResults: 6,
  batchCandidates: 48,
  payloadMaxChars: 60_000,
  runTimeoutMs: 45_000,
  maxCandidates: 20_000,
  maxConcurrentRuns: 2,
  seedLimit: 24,
  seedMaxTerms: 12,
  sufficiencyThreshold: 0.7,
  maxJevCalls: 32,
  maxParallelJevCalls: 3,
  deferCandidates: 96,
};

export interface JevServerConfig {
  baseUrl: string;
  apiKey: string;
}

export class JevSearchConfigError extends Error {
  readonly code = "JEV_NOT_CONFIGURED";

  constructor() {
    super("Jev search is not configured.");
    this.name = "JevSearchConfigError";
  }
}

export class JevSearchRequestError extends Error {
  constructor(message: string, readonly code: string, readonly statusCode: number) {
    super(message);
    this.name = "JevSearchRequestError";
  }
}

export function normalizeJevSearchInput(
  raw: JevSearchInput,
  policy: JevSearchPolicy,
): JevSearchInput & { query: string; root_node_id: string | null; limit: number; context: JevSearchContext; exhaustive: boolean } {
  if (!raw || typeof raw.query !== "string") throw new JevSearchRequestError("A search query is required.", "JEV_QUERY_REQUIRED", 400);
  const query = normalizeQuery(raw.query);
  if (raw.exhaustive !== undefined && typeof raw.exhaustive !== "boolean") {
    throw new JevSearchRequestError("Jev exhaustive must be a boolean.", "JEV_EXHAUSTIVE_INVALID", 400);
  }
  if (query.length < 1 || query.length > 400) throw new JevSearchRequestError("Jev query must be between 1 and 400 characters.", "JEV_QUERY_INVALID", 400);
  const rootNodeId = raw.root_node_id ?? null;
  if (rootNodeId !== null && (typeof rootNodeId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rootNodeId))) {
    throw new JevSearchRequestError("Jev root_node_id must be a UUID.", "JEV_ROOT_INVALID", 400);
  }
  const limit = raw.limit ?? policy.maxResults;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > policy.maxResults) {
    throw new JevSearchRequestError(`Jev limit must be between 1 and ${String(policy.maxResults)}.`, "JEV_LIMIT_INVALID", 400);
  }
  try {
    return { ...raw, query, root_node_id: rootNodeId, limit, context: normalizeContext(raw.context), exhaustive: raw.exhaustive ?? false };
  } catch {
    throw new JevSearchRequestError("Jev context fields must be text with at most 160 characters.", "JEV_CONTEXT_INVALID", 400);
  }
}

export function readJevServerConfig(env: NodeJS.ProcessEnv = process.env): JevServerConfig {
  const apiKey = env["TYPESAFE_API_KEY"]?.trim();
  const rawBaseUrl = env["TYPESAFE_BASE_URL"]?.trim();
  if (!apiKey || !rawBaseUrl) throw new JevSearchConfigError();

  let parsed: URL;
  try {
    parsed = new URL(rawBaseUrl);
  } catch {
    throw new JevSearchConfigError();
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new JevSearchConfigError();
  if (parsed.search || parsed.hash) throw new JevSearchConfigError();

  return { apiKey, baseUrl: rawBaseUrl.replace(/\/+$/, "") };
}

export function isJevConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    readJevServerConfig(env);
    return true;
  } catch (error) {
    if (error instanceof JevSearchConfigError) return false;
    throw error;
  }
}

export function policyView(policy: JevSearchPolicy = JEV_SEARCH_POLICY): JevSearchPolicyView {
  return {
    prompt_version: policy.promptVersion,
    model: policy.model,
    summary_chars: policy.summaryChars,
    structure_threshold: policy.structureThreshold,
    score_floor: policy.scoreFloor,
    relative_score_delta: policy.relativeScoreDelta,
    max_results: policy.maxResults,
    batch_candidates: policy.batchCandidates,
    payload_max_chars: policy.payloadMaxChars,
    run_timeout_ms: policy.runTimeoutMs,
    max_candidates: policy.maxCandidates,
    max_concurrent_runs: policy.maxConcurrentRuns,
    seed_limit: policy.seedLimit,
    seed_max_terms: policy.seedMaxTerms,
    sufficiency_threshold: policy.sufficiencyThreshold,
    max_jev_calls: policy.maxJevCalls,
    max_parallel_jev_calls: policy.maxParallelJevCalls,
    defer_candidates: policy.deferCandidates,
  };
}
