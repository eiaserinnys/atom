import type { TreeOutline, TreeOutlineNode } from "../../src/shared/types.js";
import type { JevMeaningPayload, JevMeaningResponse } from "../../src/shared/jev-search.js";
import { JEV_SEARCH_POLICY } from "../../src/services/jev-search/config.js";
import { searchWithJev, type JevSearchDependencies } from "../../src/services/jev-search/service.js";

const ids = {
  a: "10000000-0000-4000-8000-000000000001",
  b: "10000000-0000-4000-8000-000000000002",
  a1: "10000000-0000-4000-8000-000000000003",
  b1: "10000000-0000-4000-8000-000000000004",
  a2: "10000000-0000-4000-8000-000000000005",
  b2: "10000000-0000-4000-8000-000000000006",
  aLeaf: "10000000-0000-4000-8000-000000000007",
  bLeaf: "10000000-0000-4000-8000-000000000008",
  rootLeaf: "10000000-0000-4000-8000-000000000009",
};

function node(
  id: string,
  cardId: string,
  title: string,
  cardType: "structure" | "knowledge",
  parentNodeId: string | null,
  options: { isSymlink?: boolean; summary?: string | null; children?: TreeOutlineNode[]; descendantCount?: number } = {},
): TreeOutlineNode {
  const children = options.children ?? [];
  return {
    id,
    card_id: cardId,
    parent_node_id: parentNodeId,
    position: 0,
    is_symlink: options.isSymlink ?? false,
    title,
    card_type: cardType,
    child_count: children.length,
    descendant_count: options.descendantCount ?? children.length,
    ...(options.summary === undefined ? {} : { excerpt: options.summary }),
    children,
  };
}

function outline(nodeId: string | null, nodes: TreeOutlineNode[], canonicalNodeId = nodeId): TreeOutline {
  return { node_id: nodeId, canonical_node_id: canonicalNodeId, depth: 2, nodes };
}

function fakeTree() {
  const a1 = node(ids.a1, "card-a1", "A 하위 구조", "structure", ids.a, { summary: "A의 다음 구조", descendantCount: 1 });
  const a2 = node(ids.a2, "card-a2", "A 지식", "knowledge", ids.a, { summary: "A의 직접 지식" });
  const b1 = node(ids.b1, "card-b1", "B 하위 구조", "structure", ids.b, { summary: "B의 다음 구조", descendantCount: 1 });
  const b2 = node(ids.b2, "card-b2", "B 지식", "knowledge", ids.b, { summary: "B의 직접 지식" });
  const a = node(ids.a, "card-a", "A 구조", "structure", null, { summary: "A 모음", children: [a1, a2], descendantCount: 2 });
  const b = node(ids.b, "card-b", "B 구조", "structure", null, { summary: "B 모음", children: [b1, b2], descendantCount: 2 });
  const rootKnowledge = node(ids.rootLeaf, "card-root", "루트 지식", "knowledge", null, { summary: null });
  const aLeaf = node(ids.aLeaf, "card-a-leaf", "A 하위 지식", "knowledge", ids.a1, { summary: "A 안쪽 지식" });
  const bLeaf = node(ids.bLeaf, "card-b-leaf", "B 하위 지식", "knowledge", ids.b1, { summary: "B 안쪽 지식" });
  const calls: Array<{ nodeId: string | null; depth: number; excerptChars: number }> = [];

  const getTreeOutline = async (nodeId: string | null, depth: number, excerptChars: number): Promise<TreeOutline | null> => {
    calls.push({ nodeId, depth, excerptChars });
    if (nodeId === null) return outline(null, [a, b, rootKnowledge]);
    if (nodeId === ids.a) return outline(ids.a, [a1, a2]);
    if (nodeId === ids.b) return outline(ids.b, [b1, b2]);
    if (nodeId === ids.a1) return outline(ids.a1, [aLeaf]);
    if (nodeId === ids.b1) return outline(ids.b1, [bLeaf]);
    return outline(nodeId, []);
  };
  return { getTreeOutline, calls };
}

function answerPayload(payload: JevMeaningPayload, scoreFor: (stage: string, cardId: string) => number): JevMeaningResponse {
  const state = JSON.parse(payload.state) as { stage: string; candidates: Array<{ card_id: string }> };
  const answers = Object.fromEntries(Object.entries(payload.questions).map(([key], index) => [
    key,
    { type: "noul" as const, noul: scoreFor(state.stage, state.candidates[index]?.card_id ?? "") },
  ]));
  return { model: "jev-latest", answers, usage: { input_tokens: 17, output_tokens: 3 } };
}

describe("Jev search traversal and trace", () => {
  it("records FIFO breadth-first reads, the inclusive 0.50 gate, content selection, and terminal", async () => {
    const tree = fakeTree();
    const judgeCalls: Array<{ stage: string; cardIds: string[] }> = [];
    const deps: JevSearchDependencies = {
      searchCards: async () => [],
      getNode: async () => null,
      getTreeOutline: tree.getTreeOutline,
      judge: async (payload) => {
        const state = JSON.parse(payload.state) as { stage: string; candidates: Array<{ card_id: string }> };
        judgeCalls.push({ stage: state.stage, cardIds: state.candidates.map((candidate) => candidate.card_id) });
        return answerPayload(payload, (stage, cardId) => {
          if (stage === "sufficiency_noul") return 0.1;
          if (stage === "structure_noul") return 0.5;
          return ({ "card-a2": 0.8, "card-b2": 0.65, "card-a-leaf": 0.69, "card-b-leaf": 0.7 } as Record<string, number>)[cardId] ?? 0.4;
        });
      },
    };

    const response = await searchWithJev({ query: "  게임   규칙 ", limit: 6 }, deps);
    const outlineSteps = response.trace.steps.filter((step) => step.stage === "atom_outline");
    const structureStep = response.trace.steps.find((step) => step.stage === "structure_noul");
    const selectionStep = response.trace.steps.find((step) => step.stage === "selection");
    const rootKnowledge = response.trace.candidates.find((candidate) => candidate.card_id === "card-root");
    const structureCall = response.trace.calls.find((call) => call.stage === "structure_noul");
    const structureRequest = structureCall?.request as {
      state: { stage: string; user_prompt: string; candidates: Array<{ card_id: string }> };
      questions: Record<string, { type: string; instructions: string; criteria: { true: string; false: string } }>;
    };

    expect(tree.calls.map((call) => call.nodeId)).toEqual([null, ids.a, ids.b, ids.a1, ids.b1]);
    expect(tree.calls.every((call) => call.depth === 2 && call.excerptChars === 200)).toBe(true);
    expect(judgeCalls).toEqual([
      { stage: "structure_noul", cardIds: ["card-a1", "card-b1"] },
      { stage: "content_noul", cardIds: ["card-a2", "card-b2"] },
      { stage: "sufficiency_noul", cardIds: ["card-a2", "card-b2"] },
      { stage: "content_noul", cardIds: ["card-a-leaf", "card-b-leaf"] },
      { stage: "sufficiency_noul", cardIds: ["card-a2", "card-b-leaf", "card-a-leaf", "card-b2"] },
    ]);
    expect(response.query).toBe("게임 규칙");
    expect(response.status).toBe("complete");
    expect(response.complete).toBe(true);
    expect(response.results.map((result) => result.card_id)).toEqual(["card-a2", "card-b-leaf", "card-a-leaf", "card-b2"]);
    expect(response.results[0]?.selected_from_step_id).toBe(selectionStep?.id);
    expect(selectionStep?.selection_threshold).toBeCloseTo(0.5);
    expect(structureStep?.decisions.map((decision) => decision.action)).toEqual(["queued", "queued"]);
    expect(structureRequest.state).toMatchObject({ stage: "structure_noul", user_prompt: "게임 규칙" });
    expect(structureRequest.state.candidates.map((candidate) => candidate.card_id)).toEqual(["card-a1", "card-b1"]);
    expect(structureRequest.questions.structure_0).toMatchObject({
      type: "noul",
      instructions: expect.stringContaining("요청: 게임 규칙"),
      criteria: { true: expect.stringContaining("구조의 성격"), false: expect.any(String) },
    });
    expect(structureRequest.questions.structure_0.instructions).toContain("짧은 설명: A의 다음 구조");
    expect(structureRequest.questions.structure_0.instructions).toContain("직계 자식");
    for (const step of response.trace.steps.filter((item) => item.stage === "structure_noul" || item.stage === "content_noul")) {
      const call = response.trace.calls.find((item) => item.call_id === step.call_id);
      const answers = (call?.response as { answers: Record<string, { noul: number }> } | null)?.answers;
      expect(step.decisions.map((decision) => answers?.[decision.question_key ?? ""]?.noul)).toEqual(step.decisions.map((decision) => decision.score));
    }
    expect(JSON.stringify(structureRequest)).not.toMatch(/Bearer\s|authorization|TYPESAFE_/i);
    expect(rootKnowledge).toBeDefined();
    expect(outlineSteps[0]?.decisions.find((decision) => decision.ref === rootKnowledge?.ref)).toMatchObject({ action: "no_body", score: null });
    expect(response.trace.steps.map((step) => step.seq)).toEqual(response.trace.steps.map((_step, index) => index + 1));
    expect(outlineSteps.every((step) => step.completed_at !== null)).toBe(true);
    expect(response.trace.steps.at(-1)).toMatchObject({ stage: "run_terminal", terminal_status: "complete" });
    expect(response.trace.calls.every((call) => call.completed_at !== null)).toBe(true);
    expect(response.trace.steps.filter((step) => step.call_id).every((step) => response.trace.calls.some((call) => call.call_id === step.call_id))).toBe(true);
  });

  it("preserves a symlink occurrence, its canonical read, and physical versus traversal parents", async () => {
    const aliasId = "20000000-0000-4000-8000-000000000001";
    const aliasAgainId = "20000000-0000-4000-8000-000000000002";
    const canonicalId = "20000000-0000-4000-8000-000000000003";
    const leafId = "20000000-0000-4000-8000-000000000004";
    const alias = node(aliasId, "shared-card", "별칭 구조", "structure", null, { isSymlink: true, summary: "공유 구조" });
    const aliasAgain = node(aliasAgainId, "shared-card", "다른 경로", "structure", null, { isSymlink: true, summary: "공유 구조" });
    const leaf = node(leafId, "shared-leaf", "공유 지식", "knowledge", canonicalId, { summary: "공유 지식 발췌" });
    const calls: Array<{ nodeId: string | null; depth: number; excerptChars: number }> = [];
    const getTreeOutline = async (nodeId: string | null, depth: number, excerptChars: number): Promise<TreeOutline | null> => {
      calls.push({ nodeId, depth, excerptChars });
      if (nodeId === null) return outline(null, [alias, aliasAgain]);
      if (nodeId === aliasId && depth === 1) return outline(aliasId, [leaf], canonicalId);
      if (nodeId === aliasId && depth === 2) return outline(aliasId, [leaf], canonicalId);
      return outline(nodeId, []);
    };
    const response = await searchWithJev({ query: "공유 구조" }, {
      searchCards: async () => [],
      getNode: async () => null,
      getTreeOutline,
      judge: async (payload) => answerPayload(payload, () => 0.7),
    });
    const aliasedOccurrence = response.trace.candidates.find((candidate) => candidate.node_id === aliasAgainId);
    const discoveredOccurrence = response.trace.candidates.find((candidate) => candidate.node_id === aliasId);
    const child = response.trace.candidates.find((candidate) => candidate.node_id === leafId);
    const summaryStep = response.trace.steps.find((step) => step.stage === "atom_outline" && step.purpose === "symlink_summary");
    const expansionStep = response.trace.steps.find((step) => step.stage === "atom_outline" && step.purpose === "candidate_discovery" && step.parent_ref !== null);

    expect(calls).toEqual([
      { nodeId: null, depth: 2, excerptChars: 200 },
      { nodeId: aliasId, depth: 1, excerptChars: 0 },
      { nodeId: aliasAgainId, depth: 1, excerptChars: 0 },
      { nodeId: aliasId, depth: 2, excerptChars: 200 },
    ]);
    expect(aliasedOccurrence).toBeDefined();
    expect(discoveredOccurrence?.canonical_node_id).toBeNull();
    expect(aliasedOccurrence?.canonical_node_id).toBeNull();
    expect(response.trace.steps.flatMap((step) => step.decisions).find((decision) => decision.ref === aliasedOccurrence?.ref)).toMatchObject({ action: "alias", reused_from_ref: expect.any(String) });
    expect(summaryStep?.canonical_node_id).toBe(canonicalId);
    expect(expansionStep?.canonical_node_id).toBe(canonicalId);
    expect(child).toMatchObject({ physical_parent_node_id: canonicalId, traversal_parent_ref: expect.any(String) });
    expect(child?.traversal_parent_ref).not.toBeNull();
  });

  it("returns an empty complete result when no candidates exist", async () => {
    const response = await searchWithJev({ query: "없음" }, {
      searchCards: async () => [],
      getNode: async () => null,
      getTreeOutline: async () => outline(null, []),
      judge: async () => { throw new Error("must not judge empty input"); },
    });

    expect(response.status).toBe("complete");
    expect(response.results).toEqual([]);
    expect(response.trace.steps.map((step) => step.stage)).toEqual(["lexical_seed", "widen", "atom_outline", "selection", "run_terminal"]);
  });

  it("prunes a structure score immediately below the inclusive 0.50 gate", async () => {
    const tree = fakeTree();
    const response = await searchWithJev({ query: "게임 규칙" }, {
      searchCards: async () => [],
      getNode: async () => null,
      getTreeOutline: tree.getTreeOutline,
      judge: async (payload) => answerPayload(payload, (stage) => stage === "structure_noul" ? 0.49 : 0.1),
    });

    expect(response.trace.steps.find((step) => step.stage === "structure_noul")?.decisions).toEqual([
      expect.objectContaining({ score: 0.49, action: "pruned" }),
      expect.objectContaining({ score: 0.49, action: "pruned" }),
    ]);
    expect(tree.calls.map((call) => call.nodeId)).toEqual([null, ids.a, ids.b]);
    expect(response.results).toEqual([]);
  });

  it("retains a safe failed Noul call and does not turn missing scores into selections", async () => {
    const tree = fakeTree();
    const response = await searchWithJev({ query: "게임 규칙" }, {
      searchCards: async () => [],
      getNode: async () => null,
      getTreeOutline: tree.getTreeOutline,
      judge: async () => ({ model: "jev-latest", answers: {}, usage: { input_tokens: 5 } }),
    });

    expect(response.status).toBe("error");
    expect(response.complete).toBe(false);
    expect(response.results).toEqual([]);
    expect(response.error?.code).toBe("BAD_NOUL_RESPONSE");
    expect(response.trace.steps.at(-1)).toMatchObject({ stage: "run_terminal", terminal_status: "error" });
    expect(response.trace.calls.at(-1)?.error?.message).not.toContain("raw");
    expect(response.trace.steps.find((step) => step.stage === "structure_noul")?.decisions).toEqual([]);
    const request = response.trace.calls.find(call => call.stage === "structure_noul")?.request as {
      questions: Record<string, { instructions: string; criteria: { true: string; false: string } }>;
    };
    expect(request.questions.structure_0.instructions).toContain("요청: 게임 규칙");
    expect(request.questions.structure_0.instructions).toContain("짧은 설명: A의 다음 구조");
    expect(request.questions.structure_0.instructions).toContain("직계 자식");
    expect(request.questions.structure_0.criteria.true).toContain("구조의 성격");
    expect(JSON.stringify(request)).not.toMatch(/Bearer\s|authorization|TYPESAFE_/i);
  });

  it("discards a late Jev response after cancellation", async () => {
    const tree = fakeTree();
    const controller = new AbortController();
    let started!: () => void;
    let release!: (response: JevMeaningResponse) => void;
    let lateResponseReady!: () => void;
    const waiting = new Promise<JevMeaningResponse>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const lateResponseProcessed = new Promise<void>((resolve) => { lateResponseReady = resolve; });
    const pending = searchWithJev({ query: "게임 규칙" }, {
      searchCards: async () => [],
      getNode: async () => null,
      getTreeOutline: tree.getTreeOutline,
      judge: async (payload) => {
        started();
        await waiting;
        const response = answerPayload(payload, () => 1);
        lateResponseReady();
        return response;
      },
    }, controller.signal);

    await entered;
    controller.abort();
    let cancellationTimer!: NodeJS.Timeout;
    const cancellationDeadline = new Promise<never>((_resolve, reject) => {
      cancellationTimer = setTimeout(() => reject(new Error("Cancelled search did not return promptly.")), 250);
    });
    let response: Awaited<typeof pending>;
    try {
      response = await Promise.race([pending, cancellationDeadline]);
    } finally {
      clearTimeout(cancellationTimer);
    }

    expect(response.status).toBe("cancelled");
    expect(response.results).toEqual([]);
    const terminal = response.trace.steps.at(-1);
    const step = response.trace.steps.find((item) => item.stage === "structure_noul");
    const call = response.trace.calls.find((item) => item.call_id === step?.call_id);
    expect(terminal).toMatchObject({ stage: "run_terminal", terminal_status: "cancelled", started_at: response.completed_at, completed_at: response.completed_at });
    expect(step?.completed_at).toBeNull();
    expect(call).toBeUndefined();
    expect(step?.decisions).toEqual([]);
    const frozenTrace = JSON.stringify(response.trace);
    release({ model: "jev-latest", answers: {}, usage: { input_tokens: 1 } });
    await lateResponseProcessed;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(JSON.stringify(response.trace)).toBe(frozenTrace);

    const abortController = new AbortController();
    let abortStarted!: () => void;
    const abortEntered = new Promise<void>((resolve) => { abortStarted = resolve; });
    const abortedPending = searchWithJev({ query: "게임 규칙" }, {
      searchCards: async () => [],
      getNode: async () => null,
      getTreeOutline: tree.getTreeOutline,
      judge: async (_payload, signal) => {
        abortStarted();
        return new Promise<JevMeaningResponse>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      },
    }, abortController.signal);

    await abortEntered;
    abortController.abort();
    const abortedResponse = await abortedPending;
    const abortedTerminal = abortedResponse.trace.steps.at(-1);
    const abortedStep = abortedResponse.trace.steps.find((item) => item.stage === "structure_noul");
    const abortedCall = abortedResponse.trace.calls.find((item) => item.call_id === abortedStep?.call_id);
    expect(abortedResponse.status).toBe("cancelled");
    expect(abortedStep?.completed_at).toBeNull();
    expect(abortedCall).toBeUndefined();
    expect(abortedTerminal).toMatchObject({ stage: "run_terminal", terminal_status: "cancelled", started_at: abortedResponse.completed_at, completed_at: abortedResponse.completed_at });
  });

  it("returns limited when the candidate ceiling prevents further discovery", async () => {
    const tree = fakeTree();
    const response = await searchWithJev({ query: "게임 규칙" }, {
      searchCards: async () => [],
      getNode: async () => null,
      getTreeOutline: tree.getTreeOutline,
      judge: async (payload) => answerPayload(payload, () => 1),
      policy: { ...JEV_SEARCH_POLICY, maxCandidates: 1 },
    });

    expect(response.status).toBe("limited");
    expect(response.complete).toBe(false);
    expect(response.error?.code).toBe("CANDIDATE_LIMIT");
    expect(response.trace.candidates).toHaveLength(1);
    expect(response.trace.steps.at(-1)).toMatchObject({ stage: "run_terminal", terminal_status: "limited" });
  });
});
