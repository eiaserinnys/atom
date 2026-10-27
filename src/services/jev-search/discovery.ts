import type { CandidateOccurrence, JevSearchStep } from "../../shared/jev-search.js";
import type { TreeNodeWithCard, TreeOutline } from "../../shared/types.js";
import type { JevSearchDependencies } from "./service.js";
import type { JevSearchPolicy } from "./config.js";
import { candidateFromNode, candidateFromOutline, childSummaryFromSymlinkOutline, lexicalSeedQuery, seedMatchSnippet, toOccurrence, type JevTraversalCandidate } from "./catalog.js";
import { outlineAuditRequest, type AuditCallInput } from "./audit.js";
import { JevRunError, JevRunTrace } from "./run.js";

export interface SearchCandidate extends JevTraversalCandidate {
  ref: string;
  occurrence: CandidateOccurrence;
  discoveryOrder: number;
  structureScore?: number;
  openedByHit?: boolean;
}

interface SummaryRead {
  step: JevSearchStep;
  call: AuditCallInput;
  result: Promise<PromiseSettledResult<TreeOutline | null>>;
}

/** Reads in parallel, then commits candidates in source order for stable dedup. */
export class JevSearchCatalog {
  readonly firstByCard = new Map<string, SearchCandidate>();
  readonly opened = new Set<string>();
  readonly deferred: SearchCandidate[] = [];
  readonly rootFrontier: SearchCandidate[] = [];
  structures: SearchCandidate[] = [];
  content: SearchCandidate[] = [];
  rootPath: string[] = [];
  rootPathNodeIds: string[] = [];

  constructor(readonly deps: JevSearchDependencies, readonly run: JevRunTrace, readonly policy: JevSearchPolicy, readonly rootId: string | null) {}

  register(candidate: JevTraversalCandidate, step: JevSearchStep, origin: CandidateOccurrence["origin"], extra: Partial<CandidateOccurrence> = {}): SearchCandidate | null {
    if (this.run.candidates.length >= this.policy.maxCandidates) {
      this.run.limitCode = "CANDIDATE_LIMIT";
      return null;
    }
    const ref = `${step.id}:${String(step.candidate_refs.length + 1).padStart(4, "0")}`;
    const occurrence = { ...toOccurrence(candidate, ref, step.id), hop: step.hop, origin, ...extra };
    const found = { ...candidate, ref, occurrence, discoveryOrder: this.run.candidates.length };
    this.run.candidates.push(occurrence);
    step.candidate_refs.push(ref);
    const first = this.firstByCard.get(candidate.cardId);
    if (first) {
      occurrence.canonical_node_id = first.occurrence.canonical_node_id;
      step.decisions.push({ ref, question_key: null, score: null, action: "alias", reused_from_ref: first.ref });
      return null;
    }
    this.firstByCard.set(candidate.cardId, found);
    if (origin !== "hit_parent") {
      if (candidate.cardType === "structure") this.structures.push(found);
      else if (candidate.summary === null) step.decisions.push({ ref, question_key: null, score: null, action: "no_body", reused_from_ref: null });
      else this.content.push(found);
    }
    return found;
  }

  async ancestors(node: TreeNodeWithCard): Promise<TreeNodeWithCard[]> {
    const ancestors: TreeNodeWithCard[] = [];
    const seen = new Set([node.id]);
    let parentId = node.parent_node_id;
    while (parentId && !seen.has(parentId) && !this.run.stopped()) {
      seen.add(parentId);
      const parent = await this.deps.getNode(parentId);
      if (!parent) break;
      ancestors.unshift(parent);
      if (parent.id === this.rootId) break;
      parentId = parent.parent_node_id;
    }
    return ancestors;
  }

  async lexicalSeeds(query: string): Promise<void> {
    const orQuery = lexicalSeedQuery(query, this.policy.seedMaxTerms);
    const step = this.run.start("lexical_seed");
    const call = this.run.beginCall(step, "lexical_seed", 0, { query: orQuery, limit: this.policy.seedLimit, root_node_id: this.rootId });
    try {
      const seeds = orQuery ? await this.deps.searchCards({ query: orQuery, strategy: "strict", limit: this.policy.seedLimit, root_node_id: this.rootId ?? undefined }) : [];
      // Search results already identify structural seeds, so summaries need not
      // wait for body/path hydration. Registration below still follows rank.
      const summaries = seeds.map(seed => seed.node_id && seed.node_id !== this.rootId && seed.card_type === "structure"
        && (!this.rootId || !seed.is_symlink) && !this.run.stopped()
        ? this.prepareSummary(seed.node_id) : null);
      const [values, summaryResults] = await Promise.all([Promise.allSettled(seeds.map(async (seed, index) => {
        if (!seed.node_id || this.run.stopped()) return null;
        const node = await this.deps.getNode(seed.node_id);
        if (!node || node.id === this.rootId) return null;
        const ancestors = await this.ancestors(node);
        return { candidate: candidateFromNode(node, ancestors, this.rootId ? undefined : seed.node_path), rank: index + 1, snippet: seedMatchSnippet(seed.snippet) };
      })), Promise.all(summaries.map(read => read?.result ?? null))]);
      const found = values.map(value => {
        if (this.run.stopped() || this.run.limitCode || value.status === "rejected" || !value.value) return null;
        const seed = value.value;
        this.applySummaryMetadata(seed.candidate, summaryResults[seed.rank - 1]);
        return this.register(seed.candidate, step, "lexical_seed", { lexical_rank: seed.rank, match_snippet: seed.snippet });
      });
      const failed = values.some(value => value.status === "rejected");
      const error = failed && !this.run.stopped() ? { code: "ATOM_SEED_FAILED", message: "Atom lexical seed read failed." } : null;
      this.run.finish(step, call, { completedAt: failed && this.run.stopped() ? null : new Date().toISOString(),
        disposition: this.run.stopped() ? "skipped" : failed ? "error" : "completed", error,
        outlineResponse: { result_count: seeds.length, orphan_count: seeds.filter(s => s.node_id === null).length, candidate_refs: step.candidate_refs } });
      summaries.forEach((read, index) => {
        if (read && summaryResults[index]) this.completeSummary(read, summaryResults[index], found[index]);
      });
      if (error) throw new JevRunError(error.code, error.message);
    } catch (cause) {
      if (cause instanceof JevRunError) throw cause;
      this.readFailure(step, call, "ATOM_SEED_FAILED", "Atom lexical seed read failed.");
    }
  }

  async prepareParents(hits: SearchCandidate[]): Promise<() => SearchCandidate[]> {
    const seen = new Set<string>();
    const eligible = hits.filter(hit => {
      const id = hit.physicalParentNodeId;
      if (!id || id === this.rootId || seen.has(id)) return false;
      seen.add(id);
      const known = this.run.candidates.find(c => c.node_id === id);
      return !known || !this.opened.has(known.card_id);
    });
    const reads = eligible.map(hit => {
      const step = this.run.start("hit_parent", [hit.ref]);
      const call = this.run.beginCall(step, "hit_parent", 1, { node_id: hit.physicalParentNodeId, hit_ref: hit.ref });
      const summary = this.prepareSummary(hit.physicalParentNodeId as string);
      return { hit, step, call, summary, read: this.deps.getNode(hit.physicalParentNodeId as string) };
    });
    const [values, summaries] = await Promise.all([Promise.allSettled(reads.map(async r => {
      const node = await r.read;
      const ancestors = node ? await this.ancestors(node) : [];
      return node ? candidateFromNode(node, ancestors) : null;
    })), Promise.all(reads.map(r => r.summary.result))]);
    return () => {
    const parents: SearchCandidate[] = [];
    reads.forEach(({ hit, step, call }, index) => {
      const value = values[index];
      if (value.status === "rejected") { this.readFailure(step, call, "ATOM_PARENT_FAILED", "Atom hit parent read failed."); return; }
      const candidate = value.value;
      if (candidate) this.applySummaryMetadata(candidate, summaries[index]);
      let parent: SearchCandidate | null = null;
      if (!this.run.stopped() && candidate?.cardType === "structure" && !this.opened.has(candidate.cardId)) {
        // A previously pruned gate can be reopened using the original identity.
        parent = this.firstByCard.get(candidate.cardId) ?? this.register(candidate, step, "hit_parent", { hit_ref: hit.ref });
        if (parent) {
          this.applySummaryMetadata(parent, summaries[index]);
          parent.openedByHit = true;
          if (!step.candidate_refs.includes(parent.ref)) step.candidate_refs.push(parent.ref);
          step.decisions.push({ ref: parent.ref, question_key: null, score: null, action: "opened_by_hit", reused_from_ref: null });
          if (this.open(parent, step)) parents.push(parent);
        }
      }
      this.run.finish(step, call, { completedAt: new Date().toISOString(), disposition: this.run.stopped() ? "skipped" : "completed",
        outlineResponse: { node_id: candidate?.nodeId ?? null, candidate_refs: step.candidate_refs } });
      this.completeSummary(reads[index].summary, summaries[index], parent);
    });
    return parents;
    };
  }

  async prepareOutlines(frontier: Array<SearchCandidate | null>): Promise<() => void> {
    const reads = frontier.map(parent => {
      if (parent) this.opened.add(parent.cardId);
      const step = this.run.start("atom_outline", parent ? [parent.ref] : []);
      step.purpose = "candidate_discovery";
      step.parent_ref = parent?.ref ?? null;
      const nodeId = parent?.nodeId ?? this.rootId;
      const call = this.run.beginCall(step, "atom_outline", 0, outlineAuditRequest(nodeId, 2, this.policy.summaryChars, step.purpose, step.parent_ref));
      return { parent, step, call, nodeId, read: this.deps.getTreeOutline(nodeId, 2, this.policy.summaryChars) };
    });
    const values = await Promise.allSettled(reads.map(async read => {
      const outline = await read.read;
      const summaries = (outline?.nodes ?? []).map(node => node.card_type === "structure" && node.is_symlink && !this.rootId
        ? this.prepareSummary(node.id) : null);
      const results = await Promise.all(summaries.map(summary => summary?.result ?? null));
      return { outline, summaries, results };
    }));
    return () => { reads.forEach(({ parent, step, call, nodeId }, index) => {
      const value = values[index];
      if (value.status === "rejected" || !value.value.outline) { this.readFailure(step, call, "ATOM_OUTLINE_FAILED", "Atom tree outline read failed."); return; }
      const { outline, summaries, results } = value.value;
      step.canonical_node_id = outline.canonical_node_id;
      const foundCandidates: Array<SearchCandidate | null> = [];
      let ordinal = 0;
      if (!this.run.stopped()) for (const node of outline.nodes) {
        if (this.run.limitCode) break;
        const candidate = candidateFromOutline(node, parent?.path ?? this.rootPath, parent?.pathNodeIds ?? this.rootPathNodeIds,
          parent?.ref ?? null, parent ? parent.traversalDepth + 1 : 0);
        this.applySummaryMetadata(candidate, results[ordinal]);
        const found = this.register(candidate, step, "outline");
        foundCandidates[ordinal++] = found;
        if (nodeId === null && candidate.cardType === "structure") {
          if (found) this.structures.pop();
          const root = found ?? this.firstByCard.get(candidate.cardId);
          if (root && !this.opened.has(root.cardId)) {
            delete root.structureScore;
            if (!step.candidate_refs.includes(root.ref)) step.candidate_refs.push(root.ref);
            step.decisions.push({ ref: root.ref, question_key: null, score: null, action: "opened_root", reused_from_ref: null });
            if (this.open(root, step)) this.rootFrontier.push(root);
          }
        }
      }
      this.run.finish(step, call, { completedAt: new Date().toISOString(), disposition: this.run.stopped() ? "skipped" : "completed",
        outlineResponse: { canonical_node_id: outline.canonical_node_id, node_count: outline.nodes.length, candidate_refs: step.candidate_refs } });
      summaries.forEach((summary, index) => {
        if (summary && results[index]) this.completeSummary(summary, results[index], foundCandidates[index] ?? null);
      });
    }); };
  }

  open(candidate: SearchCandidate, step: JevSearchStep): boolean {
    if (this.opened.has(candidate.cardId)) return false;
    this.opened.add(candidate.cardId);
    if (this.rootId && candidate.isSymlink) return false;
    if (candidate.childCount !== null && candidate.childCount > this.policy.deferCandidates) {
      this.deferred.push(candidate);
      (step.deferred_refs ??= []).push(candidate.ref);
      return false;
    }
    return true;
  }

  takeDeferred(): SearchCandidate | null {
    this.deferred.sort((left, right) => Number(right.openedByHit ?? false) - Number(left.openedByHit ?? false)
      || (right.structureScore ?? 0) - (left.structureScore ?? 0)
      || left.discoveryOrder - right.discoveryOrder);
    const candidate = this.deferred.shift();
    if (!candidate) return null;
    const step = this.run.start("deferred_scan", [candidate.ref]);
    step.parent_ref = candidate.ref;
    this.run.finish(step);
    return candidate;
  }

  private applySummaryMetadata(candidate: JevTraversalCandidate, result: PromiseSettledResult<TreeOutline | null> | null | undefined): void {
    if (candidate.cardType === "structure" && result?.status === "fulfilled" && result.value) {
      candidate.childCount = result.value.nodes.length;
      candidate.childSummary = childSummaryFromSymlinkOutline(result.value.nodes);
    }
  }

  private prepareSummary(nodeId: string, ref?: string): SummaryRead {
    const step = this.run.start("atom_outline", ref ? [ref] : []);
    step.purpose = "symlink_summary";
    step.parent_ref = ref ?? null;
    const call = this.run.beginCall(step, "atom_outline", 1, outlineAuditRequest(nodeId, 1, 0, step.purpose, step.parent_ref));
    const result = Promise.allSettled([this.deps.getTreeOutline(nodeId, 1, 0)]).then(([value]) => value);
    return { step, call, result };
  }

  private completeSummary(read: SummaryRead, result: PromiseSettledResult<TreeOutline | null>, candidate: SearchCandidate | null): void {
    const { step, call } = read;
    if (candidate) { step.parent_ref = candidate.ref; step.candidate_refs = [candidate.ref]; }
    if (result.status === "fulfilled" && result.value) {
      const outline = result.value;
      if (candidate && !this.run.stopped()) candidate.childSummary = childSummaryFromSymlinkOutline(outline.nodes);
      step.canonical_node_id = outline.canonical_node_id;
      this.run.finish(step, call, { completedAt: new Date().toISOString(), disposition: this.run.stopped() ? "skipped" : "completed",
        outlineResponse: { canonical_node_id: outline.canonical_node_id, node_count: outline.nodes.length } });
    } else {
      if (candidate) candidate.childSummary = null;
      const error = { code: "ATOM_OUTLINE_FAILED", message: "Atom tree outline read failed." };
      this.run.finish(step, call, { completedAt: this.run.stopped() ? null : new Date().toISOString(), disposition: this.run.stopped() ? "skipped" : "error", error: this.run.stopped() ? null : error });
    }
  }

  private readFailure(step: JevSearchStep, call: Parameters<JevRunTrace["finish"]>[1], code: string, message: string): void {
    const stopped = this.run.stopped();
    this.run.finish(step, call, { completedAt: stopped ? null : new Date().toISOString(), disposition: stopped ? "skipped" : "error", error: stopped ? null : { code, message } });
    if (!stopped) throw new JevRunError(code, message);
  }
}
