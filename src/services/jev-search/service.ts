import { randomUUID } from "node:crypto";
import type { JevMeaningPayload, JevMeaningResponse, JevSearchInput, JevSearchObserver, JevSearchResponse, JevSearchStatus, JevSearchStopReason } from "../../shared/jev-search.js";
import type { SearchFilters, SearchResult, TreeOutline, TreeNodeWithCard } from "../../shared/types.js";
import { getNode, getTreeOutline } from "../tree.service.js";
import { searchCards } from "../search.service.js";
import { JevClient, JevError } from "./client.js";
import { JevSearchConfigError, JevSearchRequestError, JEV_SEARCH_POLICY, normalizeJevSearchInput, policyView, readJevServerConfig, type JevSearchPolicy } from "./config.js";
import { recordSelection } from "./catalog.js";
import { meaningAuditRequest } from "./audit.js";
import { buildContentPayload, buildStructurePayload, buildSufficiencyPayload, JevAnswerError, noul, selectFeedCards, takePayloadBatch } from "./prompts.js";
import { JevRunError, JevRunTrace } from "./run.js";
import { JevSearchCatalog, type SearchCandidate } from "./discovery.js";
import { tryAcquireJevRunSlot } from "./run-slots.js";

export interface JevSearchDependencies {
  getNode(nodeId: string): Promise<TreeNodeWithCard | null>;
  getTreeOutline(nodeId: string | null, depth: number, excerptChars: number): Promise<TreeOutline | null>;
  searchCards(filters: SearchFilters): Promise<SearchResult[]>;
  judge(payload: JevMeaningPayload, signal?: AbortSignal): Promise<JevMeaningResponse>;
  policy?: JevSearchPolicy;
}

interface ScoredContent { candidate: SearchCandidate; score: number }

export async function searchWithJev(rawInput: JevSearchInput, deps: JevSearchDependencies, callerSignal?: AbortSignal, observer?: JevSearchObserver): Promise<JevSearchResponse> {
  const policy = deps.policy ?? JEV_SEARCH_POLICY;
  const input = normalizeJevSearchInput(rawInput, policy);
  const releaseSlot = tryAcquireJevRunSlot(policy.maxConcurrentRuns);
  if (!releaseSlot) throw new JevSearchRequestError("Jev search is at its concurrent run limit.", "JEV_SEARCH_BUSY", 429);
  const startedAt = new Date().toISOString();
  const controller = new AbortController();
  let cancelled = callerSignal?.aborted ?? false;
  let timedOut = false;
  const onCallerAbort = () => { cancelled = true; controller.abort(); };
  if (callerSignal && !callerSignal.aborted) callerSignal.addEventListener("abort", onCallerAbort, { once: true });
  if (cancelled) controller.abort();
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, policy.runTimeoutMs);
  timeout.unref?.();
  const stopped = () => cancelled || timedOut || callerSignal?.aborted === true;
  const run = new JevRunTrace(randomUUID(), stopped, observer);
  const catalog = new JevSearchCatalog(deps, run, policy, input.root_node_id);
  const scored: ScoredContent[] = [];
  let status: JevSearchStatus = "complete";
  let stopReason: JevSearchStopReason = null;
  let error: JevSearchResponse["error"] = null;
  let lastSufficientRefs = "";
  let widened = false;
  let emittedRun = false;

  const judgePayload = async (stage: "structure_noul" | "content_noul" | "sufficiency_noul", batch: SearchCandidate[], payload: JevMeaningPayload): Promise<{ scores: number[]; frontier: SearchCandidate[] } | null> => {
    if (stopped()) return null;
    if (run.jevCalls >= policy.maxJevCalls) { run.limitCode = "CALL_BUDGET"; return null; }
    run.jevCalls += 1;
    const step = run.start(stage, batch.map(c => c.ref));
    const call = run.beginCall(step, stage, batch.length, meaningAuditRequest(payload));
    let response: JevMeaningResponse | undefined;
    try {
      response = await deps.judge(payload, controller.signal);
      if (stopped()) {
        run.finish(step, call, { completedAt: new Date().toISOString(), response, disposition: "skipped" });
        return null;
      }
      const keys = stage === "sufficiency_noul" ? ["sufficiency_0"] : batch.map((_c, i) => `${stage === "structure_noul" ? "structure" : "content"}_${i}`);
      const scores = keys.map(key => noul(response as JevMeaningResponse, key));
      const frontier: SearchCandidate[] = [];
      if (stage === "sufficiency_noul") {
        step.sufficiency_score = scores[0];
        step.sufficiency_threshold = policy.sufficiencyThreshold;
      } else {
        step.decisions = batch.map((candidate, i) => ({ ref: candidate.ref, question_key: keys[i], score: scores[i],
          action: stage === "content_noul" ? "content_scored" : scores[i] >= policy.structureThreshold ? "queued" : "pruned", reused_from_ref: null }));
        if (stage === "structure_noul") batch.forEach((candidate, index) => {
          candidate.structureScore = scores[index];
          if (scores[index] >= policy.structureThreshold && catalog.open(candidate, step)) frontier.push(candidate);
        });
      }
      run.finish(step, call, { completedAt: new Date().toISOString(), response });
      return { scores, frontier };
    } catch (cause) {
      if (stopped()) { run.finish(step, call, { completedAt: null, disposition: "skipped" }); return null; }
      const failure = safeJevFailure(cause);
      run.finish(step, call, { completedAt: new Date().toISOString(), response, error: failure, disposition: "error" });
      throw new JevRunError(failure.code, failure.message);
    }
  };

  const judgeHop = async (): Promise<{ frontier: SearchCandidate[]; hits: SearchCandidate[] }> => {
    const jobs: Array<{ stage: "structure_noul" | "content_noul"; batch: SearchCandidate[]; payload: JevMeaningPayload }> = [];
    for (const [stage, pool] of [["structure_noul", catalog.structures], ["content_noul", catalog.content]] as const) {
      const pending = [...pool];
      while (pending.length) {
        const build = (items: SearchCandidate[]) => stage === "structure_noul" ? buildStructurePayload(input.query, input.context, items, "read") : buildContentPayload(input.query, input.context, items);
        const batch = takePayloadBatch(pending.slice(0, policy.batchCandidates), policy.payloadMaxChars, build);
        jobs.push({ stage, batch, payload: build(batch) });
        pending.splice(0, batch.length);
      }
    }
    catalog.structures = [];
    catalog.content = [];
    let cursor = 0;
    let failure: unknown;
    const scoresByJob: Array<{ scores: number[]; frontier: SearchCandidate[] } | null> = [];
    await Promise.all(Array.from({ length: Math.min(policy.maxParallelJevCalls, jobs.length) }, async () => {
      while (cursor < jobs.length && !stopped() && !run.limitCode && !failure) {
        const index = cursor++;
        const job = jobs[index];
        try { scoresByJob[index] = await judgePayload(job.stage, job.batch, job.payload); }
        catch (cause) { failure = cause; }
      }
    }));
    const frontier: SearchCandidate[] = catalog.rootFrontier.splice(0), hits: SearchCandidate[] = [];
    jobs.forEach((job, index) => {
      const result = scoresByJob[index];
      if (!result) return;
      const scores = result.scores;
      frontier.push(...result.frontier);
      job.batch.forEach((candidate, i) => {
        if (job.stage === "content_noul") {
          scored.push({ candidate, score: scores[i] });
          if (scores[i] >= policy.structureThreshold) hits.push(candidate);
        }
      });
    });
    if (failure) throw failure;
    return { frontier, hits };
  };

  const sufficient = async (): Promise<boolean> => {
    if (run.limitCode || stopped()) return false;
    const selected = selectFeedCards(scored.map(item => ({ ...item, order: item.candidate.discoveryOrder })),
      { scoreFloor: policy.scoreFloor, structureThreshold: policy.structureThreshold, relativeScoreDelta: policy.relativeScoreDelta, maxResults: input.limit });
    if (!selected.length || selected[0].score < policy.structureThreshold) return false;
    const refs = selected.map(item => item.candidate.ref).join(",");
    if (refs === lastSufficientRefs) return false;
    lastSufficientRefs = refs;
    const candidates = selected.map(item => item.candidate);
    const scores = await judgePayload("sufficiency_noul", candidates, buildSufficiencyPayload(input.query, input.context, candidates));
    return scores !== null && scores.scores[0] >= policy.sufficiencyThreshold;
  };

  try {
    if (input.root_node_id) {
      let root: TreeNodeWithCard | null;
      try { root = await deps.getNode(input.root_node_id); }
      catch { throw new JevSearchRequestError("The search scope could not be read.", "JEV_ROOT_READ_FAILED", 502); }
      if (!stopped()) {
        if (!root) throw new JevSearchRequestError("The search scope node was not found.", "JEV_ROOT_NOT_FOUND", 404);
        if (root.card.card_type !== "structure") throw new JevSearchRequestError("The search scope must be a structure node.", "JEV_ROOT_NOT_STRUCTURE", 400);
        catalog.rootPath = [root.card.title];
        catalog.rootPathNodeIds = [root.id];
      }
    }
    observer?.({ event: "run", data: { schema_version: 2, engine: "jev", run_id: run.runId, query: input.query,
      root_node_id: input.root_node_id, exhaustive: input.exhaustive, started_at: startedAt, policy: policyView(policy) } });
    emittedRun = true;
    let frontier: SearchCandidate[] = [], hits: SearchCandidate[] = [];
    if (!stopped()) {
      await catalog.lexicalSeeds(input.query);
      if (!run.limitCode && !stopped()) ({ frontier, hits } = await judgeHop());
      if (await sufficient() && !input.exhaustive) stopReason = "sufficient";
    }
    run.hop = 1;
    while (!stopReason && !stopped() && !run.limitCode) {
      const [commitParents, commitOutlines] = await Promise.all([
        catalog.prepareParents(hits), catalog.prepareOutlines(frontier),
      ]);
      const parents = commitParents();
      commitOutlines();
      if (stopped() || run.limitCode) break;
      if (frontier.length === 0 && parents.length === 0) {
        const deferred = catalog.takeDeferred();
        if (deferred) (await catalog.prepareOutlines([deferred]))();
        else {
          if (widened) { stopReason = "exhausted"; break; }
          widened = true;
          const step = run.start("widen");
          step.widen_reason = run.hop === 1 ? "no_entry" : "frontier_empty";
          run.finish(step);
          (await catalog.prepareOutlines([null]))();
        }
      }
      if (stopped() || run.limitCode) break;
      const next = await judgeHop();
      if (await sufficient() && !input.exhaustive) { stopReason = "sufficient"; break; }
      frontier = [...next.frontier, ...parents];
      hits = next.hits;
      run.hop += 1;
    }
    if (stopped()) {
      status = timedOut ? "limited" : "cancelled";
      if (timedOut) run.limitCode = "RUN_TIME_LIMIT";
    } else if (run.limitCode) status = "limited";
  } catch (cause) {
    if (stopped()) {
      status = timedOut ? "limited" : "cancelled";
      if (timedOut) run.limitCode = "RUN_TIME_LIMIT";
    } else if (cause instanceof JevSearchRequestError && !emittedRun) throw cause;
    else {
      status = "error";
      error = cause instanceof JevRunError ? { code: cause.code, message: cause.message } : { code: "JEV_SEARCH_FAILED", message: "Jev search failed." };
    }
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", onCallerAbort);
    releaseSlot();
  }

  let results: JevSearchResponse["results"] = [];
  if (status === "complete" || status === "limited") {
    const selection = run.start("selection", scored.map(item => item.candidate.ref));
    results = recordSelection(selection, scored, input.limit, policy);
    run.finish(selection);
  }
  if (status === "limited") error = { code: run.limitCode ?? "RUN_TIME_LIMIT", message: run.limitCode === "CALL_BUDGET" ? "Jev search reached its call budget." : run.limitCode === "CANDIDATE_LIMIT" ? "Jev search reached its candidate limit." : "Jev search reached its time limit." };
  if (status === "cancelled") error = { code: "CANCELLED", message: "Jev search was cancelled." };
  if (status !== "complete") stopReason = null;
  const completedAt = new Date().toISOString();
  const terminal = run.start("run_terminal", [], completedAt);
  terminal.completed_at = completedAt;
  terminal.terminal_status = status;
  terminal.terminal_code = error?.code ?? null;
  terminal.stop_reason = stopReason;
  run.finish(terminal);
  const response: JevSearchResponse = {
    schema_version: 2, engine: "jev", run_id: run.runId, query: input.query, root_node_id: input.root_node_id, exhaustive: input.exhaustive,
    status, complete: status === "complete", stop_reason: stopReason, started_at: startedAt, completed_at: completedAt,
    policy: policyView(policy), results,
    trace: { candidates: run.candidates, steps: run.steps, calls: run.calls.sort((a, b) => a.seq - b.seq) }, error,
  };
  observer?.({ event: "done", data: { status, complete: response.complete, stop_reason: stopReason, completed_at: completedAt, results, error } });
  return response;
}

export async function runConfiguredJevSearch(input: JevSearchInput, signal?: AbortSignal, observer?: JevSearchObserver): Promise<JevSearchResponse> {
  let config;
  try { config = readJevServerConfig(); }
  catch (cause) {
    if (cause instanceof JevSearchConfigError) throw new JevSearchRequestError(cause.message, cause.code, 503);
    throw cause;
  }
  const client = new JevClient(config.baseUrl, config.apiKey);
  return searchWithJev(input, { getNode, getTreeOutline, searchCards, judge: client.judge.bind(client) }, signal, observer);
}

function safeJevFailure(error: unknown): { code: string; message: string } {
  if (error instanceof JevAnswerError) return { code: error.code, message: "Jev response did not include a valid score for every candidate." };
  if (error instanceof JevError) return { code: error.code, message: error.message };
  return { code: "JEV_JUDGMENT_FAILED", message: "Jev judgment failed." };
}
