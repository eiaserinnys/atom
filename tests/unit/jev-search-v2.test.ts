import type { SearchFilters, SearchResult, TreeNodeWithCard, TreeOutline, TreeOutlineNode } from "../../src/shared/types.js";
import type { JevMeaningPayload, JevSearchResponse } from "../../src/shared/jev-search.js";
import { searchWithJev } from "../../src/services/jev-search/service.js";
import { JEV_SEARCH_POLICY } from "../../src/services/jev-search/config.js";

const parentId = "10000000-0000-4000-8000-000000000001";
const hitId = "10000000-0000-4000-8000-000000000002";
const siblingId = "10000000-0000-4000-8000-000000000003";

function node(id: string, cardType: "structure" | "knowledge", parent: string | null): TreeNodeWithCard {
  return { id, card_id: id, parent_node_id: parent, position: 0, is_symlink: false, created_at: "", journal_limit: null,
    card: { id, card_type: cardType, title: id === parentId ? "모음" : "게임 규칙", content: "# 원문 내용", references: [], tags: [], card_timestamp: null, content_timestamp: null, source_type: null, source_ref: null, source_snapshot: null, version: 1, updated_at: "", created_by: null, updated_by: null } };
}
function outlineNode(n: TreeNodeWithCard): TreeOutlineNode {
  return { id: n.id, card_id: n.card_id, parent_node_id: n.parent_node_id, position: 0, is_symlink: n.is_symlink, title: n.card.title,
    card_type: n.card.card_type, excerpt: "원문 내용", child_count: 0, descendant_count: 0, children: [] };
}
function seed(n: TreeNodeWithCard): SearchResult {
  return { card_id: n.card_id, node_id: n.id, card_type: n.card.card_type, title: n.card.title, is_symlink: false,
    snippet: "<b>일치</b> 조각", node_path: n.parent_node_id ? ["모음"] : [] };
}
function fixture(options: { seeds?: TreeNodeWithCard[]; sufficient?: number; budget?: number; structureScore?: number } = {}) {
  const parent = node(parentId, "structure", null);
  const hit = node(hitId, "knowledge", parentId);
  const sibling = node(siblingId, "knowledge", parentId);
  const nodes = [parent, hit, sibling];
  const reads: Array<{ id: string | null; depth: number }> = [];
  const judgments: Array<{ stage: string; cards: string[]; payload: JevMeaningPayload }> = [];
  const filters: SearchFilters[] = [];
  const deps = {
    getNode: async (id: string) => nodes.find(n => n.id === id) ?? null,
    getTreeOutline: async (id: string | null, depth: number): Promise<TreeOutline> => {
      reads.push({ id, depth });
      return { node_id: id, canonical_node_id: id, depth, nodes: (id === null ? [parent] : id === parentId ? [hit, sibling] : []).map(outlineNode) };
    },
    searchCards: async (f: SearchFilters) => { filters.push(f); return (options.seeds ?? [hit]).map(seed); },
    judge: async (payload: JevMeaningPayload) => {
      const state = JSON.parse(payload.state);
      judgments.push({ stage: state.stage, cards: state.candidates.map((n: { card_id: string }) => n.card_id), payload });
      return { model: "jev-latest", usage: { input_tokens: 17, output_tokens: 2 }, answers: Object.fromEntries(Object.keys(payload.questions).map(key =>
        [key, { type: "noul", noul: key === "sufficiency_0" ? options.sufficient ?? 0.1 : key.startsWith("structure") ? options.structureScore ?? 0.5 : 0.8 }])) };
    },
    policy: { ...JEV_SEARCH_POLICY, ...(options.budget === undefined ? {} : { maxJevCalls: options.budget }) },
  };
  return { deps, hit, parent, reads, judgments, filters };
}

describe("Jev v2 hop contracts", () => {
  it("13 opens unscoped virtual-root structures without a judgment and still scores root knowledge", async () => {
    const f = fixture({ seeds: [], structureScore: 0.43 });
    const second = node("10000000-0000-4000-8000-000000000004", "structure", null);
    second.is_symlink = true;
    const rootKnowledge = node("10000000-0000-4000-8000-000000000005", "knowledge", null);
    const r = await searchWithJev({ query: "게임" }, {
      ...f.deps,
      getTreeOutline: async (id, depth) => {
        if (id === null) return { node_id: null, canonical_node_id: null, depth, nodes: [f.parent, second, rootKnowledge].map(outlineNode) };
        return f.deps.getTreeOutline(id, depth);
      },
    });
    const rootRead = r.trace.steps.find(s => s.purpose === "candidate_discovery" && s.parent_ref === null);
    expect(rootRead?.decisions.filter(d => String(d.action) === "opened_root")).toHaveLength(2);
    expect(rootRead?.decisions.filter(d => String(d.action) === "opened_root").every(d => d.score === null && d.question_key === null)).toBe(true);
    expect(f.judgments.filter(j => j.stage === "structure_noul")).toEqual([]);
    expect(f.judgments.filter(j => j.stage === "content_noul").map(j => j.cards)).toEqual([[rootKnowledge.id], [hitId, siblingId]]);
    expect(f.reads).toEqual([{ id: second.id, depth: 1 }, { id: parentId, depth: 2 }, { id: second.id, depth: 2 }]);
  });
  it("13 keeps scoped child gates and only reopens a pruned seed when it is a virtual-root child", async () => {
    const f = fixture({ seeds: [], structureScore: 0.43 });
    const child = node("10000000-0000-4000-8000-000000000004", "structure", parentId);
    const scoped = await searchWithJev({ query: "게임", root_node_id: parentId }, {
      ...f.deps,
      getTreeOutline: async (id, depth) => ({ node_id: id, canonical_node_id: id, depth, nodes: [outlineNode(child)] }),
    });
    expect(f.judgments.filter(j => j.stage === "structure_noul").map(j => j.cards)).toEqual([[child.id]]);
    expect(scoped.trace.steps.flatMap(s => s.decisions).some(d => String(d.action) === "opened_root")).toBe(false);
    const seedFixture = fixture({ seeds: [f.parent], structureScore: 0.43 });
    const unscoped = await searchWithJev({ query: "게임" }, seedFixture.deps);
    expect(unscoped.trace.steps.flatMap(s => s.decisions)).toContainEqual(expect.objectContaining({ action: "opened_root", score: null, question_key: null }));
    expect(seedFixture.judgments.filter(j => j.stage === "structure_noul").map(j => j.cards)).toEqual([[parentId]]);
    expect(seedFixture.reads.filter(r => r.id === parentId && r.depth === 2)).toHaveLength(1);
    const openedFixture = fixture({ seeds: [f.parent] });
    const alreadyOpened = await searchWithJev({ query: "게임" }, openedFixture.deps);
    expect(alreadyOpened.trace.steps.flatMap(s => s.decisions).some(d => d.action === "opened_root")).toBe(false);
    expect(openedFixture.reads.filter(r => r.id === parentId && r.depth === 2)).toHaveLength(1);
  });
  it("1 stops at sufficient seeds in hop zero without an outline read", async () => {
    const f = fixture({ sufficient: 0.7 });
    const r = await searchWithJev({ query: "게임, 규칙 게임 x" }, f.deps);
    expect(r).toMatchObject({ schema_version: 2, status: "complete", stop_reason: "sufficient" });
    expect(f.reads).toEqual([]);
    expect(f.filters).toEqual([{ query: "게임 OR 규칙", strategy: "strict", limit: 24, root_node_id: undefined }]);
    expect(f.judgments.map(j => j.stage)).toEqual(["content_noul", "sufficiency_noul"]);
    expect(JSON.stringify(f.judgments[0].payload)).toContain("원문 내용");
    expect(JSON.stringify(f.judgments[0].payload)).not.toContain("일치");
    expect(r.trace.candidates[0]).toMatchObject({ hop: 0, origin: "lexical_seed", lexical_rank: 1, match_snippet: "일치 조각" });
  });
  it("2 opens the hit parent without a gate and scores siblings in the following hop", async () => {
    const f = fixture();
    const r = await searchWithJev({ query: "게임 규칙" }, f.deps);
    const p = r.trace.candidates.find(n => n.node_id === parentId);
    const sibling = r.trace.candidates.find(n => n.node_id === siblingId);
    expect(p).toMatchObject({ hop: 1, origin: "hit_parent", hit_ref: r.trace.candidates[0].ref });
    expect(sibling).toMatchObject({ hop: 2, origin: "outline", traversal_parent_ref: p?.ref });
    expect(r.trace.steps.flatMap(s => s.decisions)).toContainEqual(expect.objectContaining({ ref: p?.ref, action: "opened_by_hit", score: null }));
    expect(f.judgments.some(j => j.stage === "structure_noul" && j.cards.includes(parentId))).toBe(false);
    expect(f.judgments.filter(j => j.stage === "content_noul").map(j => j.cards)).toEqual([[hitId], [siblingId]]);
  });
  it("3 finishes each hop's judgments before reading the next hop", async () => {
    const f = fixture({ seeds: [] });
    const r = await searchWithJev({ query: "게임 규칙" }, f.deps);
    expect(f.judgments.map(j => j.stage)).toEqual(["content_noul", "sufficiency_noul"]);
    expect(r.trace.steps.filter(s => ["structure_noul", "content_noul"].includes(s.stage)).map(s => ({ stage: s.stage, hop: (s as unknown as { hop: number }).hop }))).toEqual([
      { stage: "content_noul", hop: 2 }]);
  });
  it("4 widens only once then exhausts when there is no entry", async () => {
    const f = fixture({ seeds: [], structureScore: 0.49 });
    const r = await searchWithJev({ query: "없음" }, f.deps);
    expect(r).toMatchObject({ status: "complete", stop_reason: "exhausted" });
    expect(r.trace.steps.filter(s => String(s.stage) === "widen")).toHaveLength(1);
    expect(f.reads.map(r => r.id)).toEqual([null, parentId]);
  });
  it("5 returns scored selections when the Jev call budget is reached", async () => {
    const f = fixture({ budget: 1 });
    const r = await searchWithJev({ query: "게임 규칙" }, f.deps);
    expect(r).toMatchObject({ status: "limited", complete: false, stop_reason: null, error: { code: "CALL_BUDGET" } });
    expect(f.judgments).toHaveLength(1);
    expect(r.results.map(n => n.card_id)).toEqual([hitId]);
  });
  it("6 records rediscovered seeds as aliases without rejudging them", async () => {
    const f = fixture();
    const r = await searchWithJev({ query: "게임 규칙" }, f.deps);
    const again = r.trace.candidates.filter(n => n.card_id === hitId)[1];
    expect(again).toBeDefined();
    expect(r.trace.steps.flatMap(s => s.decisions)).toContainEqual(expect.objectContaining({ ref: again?.ref, action: "alias", reused_from_ref: r.trace.candidates[0].ref }));
    expect(f.judgments.filter(j => j.stage === "content_noul").flatMap(j => j.cards).filter(id => id === hitId)).toHaveLength(1);
  });
  it("7 emits ordered deltas with candidates only in their discovery step and safe calls", async () => {
    const f = fixture({ sufficient: 0.7 });
    const events: Array<{ event: string; data: any }> = [];
    const run = searchWithJev as unknown as (input: { query: string }, deps: typeof f.deps, signal: undefined, observer: (e: { event: string; data: any }) => void) => Promise<JevSearchResponse>;
    const r = await run({ query: "게임 규칙" }, f.deps, undefined, e => events.push(structuredClone(e)));
    expect(events[0]?.event).toBe("run");
    expect(events.at(-1)?.event).toBe("done");
    for (const step of r.trace.steps) {
      const started = events.findIndex(e => e.event === "step_started" && e.data.id === step.id);
      const completed = events.findIndex(e => e.event === "step_completed" && e.data.step.id === step.id);
      expect(started).toBeGreaterThan(0);
      expect(completed).toBeGreaterThan(started);
    }
    const completed = events.filter(e => e.event === "step_completed");
    expect(completed.flatMap(e => e.data.candidates)).toEqual(r.trace.candidates);
    for (const e of completed) {
      expect(e.data.candidates.every((c: any) => c.discovered_in_step_id === e.data.step.id)).toBe(true);
      if (e.data.call) expect(e.data.call).toEqual(r.trace.calls.find(c => c.call_id === e.data.call.call_id));
    }
    expect(events.at(-1)?.data).toMatchObject({ status: "complete", stop_reason: "sufficient", results: r.results });
  });
  it("9 runs up to three judgments concurrently, preserves order and never oversends the budget", async () => {
    async function run(reverse: boolean, budget = 24) {
      const seeds = Array.from({ length: 5 }, (_, index) => node(`20000000-0000-4000-8000-00000000000${index}`, "knowledge", null));
      const f = fixture({ seeds });
      let active = 0, maximum = 0, sent = 0;
      const r = await searchWithJev({ query: "게임" }, {
        ...f.deps,
        getNode: async (id: string) => {
          await new Promise(resolve => setTimeout(resolve, reverse ? 6 - Number(id.at(-1)) : Number(id.at(-1))));
          return seeds.find(n => n.id === id) ?? null;
        },
        judge: async payload => {
          sent += 1; active += 1; maximum = Math.max(maximum, active);
          const state = JSON.parse(payload.state);
          const index = Number(state.candidates[0]?.card_id.at(-1));
          await new Promise(resolve => setTimeout(resolve, reverse ? 12 - index : index + 2));
          active -= 1;
          return { model: "jev-latest", usage: { input_tokens: 1 }, answers: Object.fromEntries(Object.keys(payload.questions).map(key => [key, { type: "noul", noul: key === "sufficiency_0" ? 0.7 : 0.8 }])) };
        },
        policy: { ...JEV_SEARCH_POLICY, batchCandidates: 1, maxJevCalls: budget },
      });
      return { r, maximum, sent };
    }
    const a = await run(false), b = await run(true), limited = await run(true, 2);
    expect(a.maximum).toBe(3);
    expect(b.maximum).toBe(3);
    expect(a.r.results.map(n => n.card_id)).toEqual(b.r.results.map(n => n.card_id));
    expect(a.r.trace.candidates.map(n => n.card_id)).toEqual(b.r.trace.candidates.map(n => n.card_id));
    expect(limited.sent).toBe(2);
    expect(limited.maximum).toBe(2);
    expect(limited.r).toMatchObject({ status: "limited", error: { code: "CALL_BUDGET" } });
  });
  it("9 starts structural seed summaries alongside body and ancestor reads", async () => {
    const f = fixture();
    const started: string[] = [];
    let release!: () => void;
    const body = new Promise<void>(resolve => { release = resolve; });
    const pending = searchWithJev({ query: "게임" }, {
      ...f.deps,
      searchCards: async () => [seed(f.parent)],
      getNode: async id => {
        if (id === parentId) { started.push("body"); await body; }
        return f.deps.getNode(id);
      },
      getTreeOutline: async (id, depth) => {
        if (depth === 1) started.push("summary");
        return f.deps.getTreeOutline(id, depth);
      },
    });
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(started).toEqual(expect.arrayContaining(["body", "summary"]));
    } finally { release(); await pending; }
  });
});
