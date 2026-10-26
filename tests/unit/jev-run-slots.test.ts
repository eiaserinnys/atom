import type { TreeOutline, TreeOutlineNode } from "../../src/shared/types.js";
import type { JevMeaningPayload, JevMeaningResponse } from "../../src/shared/jev-search.js";
import { JEV_SEARCH_POLICY } from "../../src/services/jev-search/config.js";
import { evaluateJevCards, JevEvaluationRequestError, type JevEvaluationDependencies } from "../../src/services/jev-search/evaluate.js";
import { searchWithJev, type JevSearchDependencies } from "../../src/services/jev-search/service.js";

const cardId = "10000000-0000-4000-8000-000000000001";
const nodeId = "20000000-0000-4000-8000-000000000001";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function answer(payload: JevMeaningPayload, score = 0.8): JevMeaningResponse {
  return { model: "jev-latest", answers: Object.fromEntries(Object.keys(payload.questions).map(key => [key, { type: "noul", noul: score }])), usage: { input_tokens: 1 } };
}

function searchDependencies(judge: JevSearchDependencies["judge"]): JevSearchDependencies {
  const leaf: TreeOutlineNode = {
    id: nodeId, card_id: cardId, parent_node_id: null, position: 0, is_symlink: false,
    title: "카드", card_type: "knowledge", child_count: 0, descendant_count: 0, excerpt: "본문",
    children: [],
  };
  const outline: TreeOutline = { node_id: null, canonical_node_id: null, depth: 2, nodes: [leaf] };
  return { searchCards: async () => [], getNode: async () => null, getTreeOutline: async () => outline, judge };
}

function evaluationDependencies(judge: JevEvaluationDependencies["judge"]): JevEvaluationDependencies {
  return {
    loadCandidates: async ids => ({ candidates: ids.map((id, index) => ({
      cardId: id, nodeId, cardVersion: 1, title: "카드", path: [], summary: "본문",
    })), skipped: [] }),
    judge,
  };
}

describe("shared Jev search and evaluation slots", () => {
  it("allows one search and one evaluation, then rejects a third run immediately", async () => {
    const gate = deferred();
    const entered = deferred();
    let activeJudges = 0;
    const hold = async (payload: JevMeaningPayload) => {
      activeJudges += 1;
      if (activeJudges === 2) entered.resolve();
      await gate.promise;
      return answer(payload);
    };
    const search = searchWithJev({ query: "검색" }, searchDependencies(hold));
    const evaluation = evaluateJevCards({ query: "질의", card_ids: [cardId] }, evaluationDependencies(hold));
    await entered.promise;

    await expect(evaluateJevCards({ query: "세 번째", card_ids: [cardId] }, evaluationDependencies(async payload => answer(payload))))
      .rejects.toMatchObject({ code: "JEV_EVALUATION_BUSY", statusCode: 429 });
    gate.resolve();
    await Promise.all([search, evaluation]);
  });

  it("keeps the established search busy code when both slots are searches", async () => {
    const gate = deferred();
    const entered = deferred();
    let activeJudges = 0;
    const hold = async (payload: JevMeaningPayload) => {
      activeJudges += 1;
      if (activeJudges === 2) entered.resolve();
      await gate.promise;
      return answer(payload);
    };
    const one = searchWithJev({ query: "검색 하나" }, searchDependencies(hold));
    const two = searchWithJev({ query: "검색 둘" }, searchDependencies(hold));
    await entered.promise;

    await expect(evaluateJevCards({ query: "평가", card_ids: [cardId] }, evaluationDependencies(async payload => answer(payload))))
      .rejects.toMatchObject({ code: "JEV_EVALUATION_BUSY", statusCode: 429 });
    await expect(searchWithJev({ query: "세 번째 검색" }, { ...searchDependencies(async payload => answer(payload)), policy: { ...JEV_SEARCH_POLICY } }))
      .rejects.toMatchObject({ code: "JEV_SEARCH_BUSY", statusCode: 429 });
    gate.resolve();
    await Promise.all([one, two]);
  });

  it("keeps the established search busy code when both slots are evaluations", async () => {
    const gate = deferred();
    const entered = deferred();
    let active = 0;
    const hold = async (payload: JevMeaningPayload) => {
      active += 1;
      if (active === 2) entered.resolve();
      await gate.promise;
      return answer(payload);
    };
    const one = evaluateJevCards({ query: "평가 하나", card_ids: [cardId] }, evaluationDependencies(hold));
    const two = evaluateJevCards({ query: "평가 둘", card_ids: [cardId] }, evaluationDependencies(hold));
    await entered.promise;

    await expect(searchWithJev({ query: "검색" }, searchDependencies(async payload => answer(payload))))
      .rejects.toMatchObject({ code: "JEV_SEARCH_BUSY", statusCode: 429 });
    gate.resolve();
    await Promise.all([one, two]);
  });
});
