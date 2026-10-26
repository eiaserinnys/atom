import type { SearchResult, TreeNodeWithCard, TreeOutlineNode } from "../../src/shared/types.js";
import { searchWithJev, type JevSearchDependencies } from "../../src/services/jev-search/service.js";

function node(id: string, type: "structure" | "knowledge", parent: string | null = null): TreeNodeWithCard {
  return { id, card_id: id, parent_node_id: parent, position: 0, is_symlink: false, created_at: "", journal_limit: null,
    card: { id, card_type: type, title: id, content: "가짜 본문", references: [], tags: [], card_timestamp: null, content_timestamp: null,
      source_type: null, source_ref: null, source_snapshot: null, version: 1, updated_at: "", created_by: null, updated_by: null } };
}
function seed(n: TreeNodeWithCard): SearchResult {
  return { card_id: n.card_id, node_id: n.id, card_type: n.card.card_type, title: n.card.title, is_symlink: false, snippet: "일치", node_path: [] };
}
function fixture(seeds: TreeNodeWithCard[], children: Record<string, TreeNodeWithCard[]>, score: (stage: string, cardId: string, ids: string[]) => number) {
  const nodes = new Map([...seeds, ...Object.values(children).flat()].map(n => [n.id, n]));
  const judged: Array<{ stage: string; ids: string[] }> = [];
  const reads: Array<{ id: string | null; depth: number }> = [];
  const deps: JevSearchDependencies = {
    searchCards: async () => seeds.map(seed),
    getNode: async id => nodes.get(id) ?? null,
    getTreeOutline: async (id, depth) => { reads.push({ id, depth }); return { node_id: id, canonical_node_id: id, depth,
      nodes: (children[id ?? "ROOT"] ?? []).map(n => ({ id: n.id, card_id: n.card_id, parent_node_id: n.parent_node_id, position: 0, is_symlink: false,
        title: n.card.title, card_type: n.card.card_type, excerpt: n.card.content, child_count: (children[n.id] ?? []).length, descendant_count: (children[n.id] ?? []).length, children: [] } as TreeOutlineNode)) }; },
    judge: async payload => {
      const state = JSON.parse(payload.state), ids = state.candidates.map((c: { card_id: string }) => c.card_id);
      judged.push({ stage: state.stage, ids });
      return { model: "fixture", usage: { input_tokens: 1 }, answers: Object.fromEntries(Object.keys(payload.questions).map((key, index) =>
        [key, { type: "noul", noul: score(state.stage, ids[index] ?? "", ids) }])) };
    },
  };
  return { deps, judged, reads };
}
const group = (parent: string, type: "structure" | "knowledge", count: number) => Array.from({ length: count }, (_, i) => node(`${parent}-${i}`, type, parent));

describe("Jev document revisions 3 and 5", () => {
  it("14 defers large structures before reading children and scores the cheap path first", async () => {
    const large = node("large", "structure"), cheap = node("cheap", "structure");
    const f = fixture([large, cheap], { large: group("large", "knowledge", 97), cheap: [node("target", "knowledge", "cheap")] },
      stage => stage === "sufficiency_noul" ? 0.7 : 0.9);
    const r = await searchWithJev({ query: "가짜 질의" }, f.deps);
    expect(r.results.map(c => c.card_id)).toEqual(["target"]);
    expect(r.trace.candidates.filter(c => c.card_type === "knowledge")).toHaveLength(1);
    const largeCandidate = r.trace.candidates.find(c => c.card_id === "large");
    expect(largeCandidate).toMatchObject({ child_count: 97 });
    expect(r.trace.steps.find(s => s.stage === "structure_noul")).toMatchObject({ deferred_refs: [largeCandidate?.ref] });
    expect(f.reads.some(read => read.id === "large" && read.depth === 2)).toBe(false);
    expect(f.judged.filter(j => j.stage === "content_noul").flatMap(j => j.ids)).toEqual(["target"]);
    expect(r.trace.steps.some(s => String(s.stage) === "deferred_scan")).toBe(false);
  });

  it("14 defers root-opened structures without discovering their children", async () => {
    const large = node("large", "structure"), cheap = node("cheap", "structure");
    const f = fixture([], { ROOT: [large, cheap], large: group("large", "structure", 97), cheap: [node("target", "knowledge", "cheap")] },
      stage => stage === "sufficiency_noul" ? 0.7 : 0.9);
    const r = await searchWithJev({ query: "가짜 질의" }, f.deps);
    expect(r.results.map(c => c.card_id)).toEqual(["target"]);
    expect(r.trace.candidates.map(c => c.card_id)).toEqual(["large", "cheap", "target"]);
    const root = r.trace.steps.find(s => s.purpose === "candidate_discovery");
    expect(root).toMatchObject({ deferred_refs: [r.trace.candidates[0].ref] });
    expect(f.reads.some(read => read.id === "large" && read.depth === 2)).toBe(false);
    expect(f.judged.filter(j => j.stage === "structure_noul")).toEqual([]);
  });

  it("14 reads all children on resumption and opens exactly 96 children immediately", async () => {
    for (const count of [96, 97]) {
      const large = node("large", "structure");
      const f = fixture([large], { large: group("large", "structure", count) }, (_stage, id) => id === "large" ? 0.9 : 0.1);
      const r = await searchWithJev({ query: "가짜 질의" }, f.deps);
      const scans = r.trace.steps.filter(s => String(s.stage) === "deferred_scan");
      expect(scans).toHaveLength(count === 97 ? 1 : 0);
      if (scans.length) expect(scans[0].candidate_refs).toEqual([r.trace.candidates[0].ref]);
      expect(f.judged.filter(j => j.stage === "structure_noul").flatMap(j => j.ids)).toHaveLength(count + 1);
    }
  });

  it("14 resumes deferred structures before widening, by hit, gate score and discovery order", async () => {
    const h = node("hit-parent", "structure"), b = node("high-first", "structure"), c = node("low", "structure"), d = node("high-second", "structure");
    const hit = node("hit", "knowledge", h.id);
    const f = fixture([b, c, d, hit], { ROOT: [h], [h.id]: [hit, ...group(h.id, "knowledge", 97)],
      [b.id]: group(b.id, "knowledge", 97), [c.id]: group(c.id, "knowledge", 97), [d.id]: group(d.id, "knowledge", 97) },
      (stage, id) => stage === "sufficiency_noul" ? 0.1 : stage === "structure_noul" ? id === c.id ? 0.6 : 0.9 : id === hit.id ? 0.8 : 0.1);
    const r = await searchWithJev({ query: "가짜 질의" }, f.deps);
    const scans = r.trace.steps.filter(s => String(s.stage) === "deferred_scan");
    const byRef = new Map(r.trace.candidates.map(c => [c.ref, c.card_id]));
    expect(scans.map(s => byRef.get(s.parent_ref ?? ""))).toEqual([h.id, b.id, d.id, c.id]);
    expect(scans.every(s => s.candidate_refs.length === 1 && s.candidate_refs[0] === s.parent_ref)).toBe(true);
    const hitParent = r.trace.candidates.find(c => c.card_id === h.id);
    expect(hitParent).toMatchObject({ child_count: 98 });
    expect(r.trace.steps.find(s => s.stage === "hit_parent")).toMatchObject({ deferred_refs: [hitParent?.ref] });
    expect(r.trace.steps.every(s => !("deferred_kinds" in s))).toBe(true);
    const widen = r.trace.steps.find(s => s.stage === "widen");
    expect(widen?.seq).toBeGreaterThan(scans.at(-1)?.seq ?? Infinity);
    expect(f.judged.filter(j => j.stage === "content_noul").flatMap(j => j.ids)).toHaveLength(389);
    expect(r).toMatchObject({ status: "complete", stop_reason: "exhausted", policy: { max_jev_calls: 32, defer_candidates: 96 } });
  });

  it("15 records sufficiency but continues exhaustive runs to exhaustion", async () => {
    const h = node("parent", "structure"), hit = node("hit", "knowledge", h.id), added = node("added", "knowledge", h.id);
    const f = fixture([hit], { ROOT: [h], [h.id]: [hit, added] }, () => 0.9);
    const events: any[] = [];
    const input = { query: "가짜 질의", exhaustive: true };
    const r = await searchWithJev(input, f.deps, undefined, e => events.push(e));
    expect(r).toMatchObject({ exhaustive: true, status: "complete", stop_reason: "exhausted" });
    expect(events[0]).toMatchObject({ event: "run", data: { exhaustive: true } });
    expect(r.results.map(c => c.card_id)).toEqual([hit.id, added.id]);
    expect(f.judged.filter(j => j.stage === "sufficiency_noul")).toHaveLength(2);
    expect(r.trace.steps.filter(s => s.stage === "sufficiency_noul").every(s => s.sufficiency_score === 0.9)).toBe(true);
  });

  it("12 reasks sufficiency for a changed selected bundle, and skips an unchanged bundle", async () => {
    for (const addedScore of [0.6, 0.2]) {
      const h = node("parent", "structure"), hit = node("hit", "knowledge", h.id), added = node("added", "knowledge", h.id);
      const f = fixture([hit], { ROOT: [h], [h.id]: [hit, added] }, (stage, id) => stage === "sufficiency_noul" ? 0.1 : id === hit.id ? 0.93 : addedScore);
      const r = await searchWithJev({ query: "가짜 질의" }, f.deps);
      expect(f.judged.filter(j => j.stage === "sufficiency_noul").map(j => j.ids)).toEqual(addedScore === 0.6 ? [[hit.id], [hit.id, added.id]] : [[hit.id]]);
      expect(r.results.map(c => c.card_id)).toEqual(addedScore === 0.6 ? [hit.id, added.id] : [hit.id]);
    }
  });
});
