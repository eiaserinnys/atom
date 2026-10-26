import type { JevMeaningPayload, JevMeaningResponse } from "../../src/shared/jev-search.js";
import { jest } from "@jest/globals";
import { JEV_SEARCH_POLICY, JevSearchConfigError } from "../../src/services/jev-search/config.js";
import {
  evaluateJevCards,
  JevEvaluationRequestError,
  type JevEvaluationCandidate,
  type JevEvaluationDependencies,
} from "../../src/services/jev-search/evaluate.js";

const ids = {
  first: "10000000-0000-4000-8000-000000000001",
  second: "10000000-0000-4000-8000-000000000002",
  third: "10000000-0000-4000-8000-000000000003",
};

function candidate(cardId: string, number: number, summary = "본문 발췌"): JevEvaluationCandidate {
  return {
    cardId,
    nodeId: `30000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
    cardVersion: number,
    title: `카드 ${number}`,
    path: ["프로젝트"],
    summary,
  };
}

function answer(payload: JevMeaningPayload, score: (key: string) => number): JevMeaningResponse {
  return {
    model: "jev-latest",
    answers: Object.fromEntries(Object.keys(payload.questions).map(key => [key, { type: "noul", noul: score(key) }])),
    usage: { input_tokens: 17, output_tokens: 3 },
  };
}

function dependencies(overrides: Partial<JevEvaluationDependencies> = {}): JevEvaluationDependencies {
  return {
    loadCandidates: async cardIds => ({
      candidates: cardIds.map((id, index) => candidate(id, index + 1)),
      skipped: [],
    }),
    judge: async payload => answer(payload, () => 0.8),
    ...overrides,
  };
}

describe("Jev content evaluation", () => {
  it("normalizes the original query/context and returns scored candidates in input order after skips", async () => {
    const calls: Array<{ cardIds: string[]; signal: AbortSignal }> = [];
    const payloads: JevMeaningPayload[] = [];
    const loadCandidates = async (cardIds: string[], signal: AbortSignal) => {
      calls.push({ cardIds, signal });
      return {
        candidates: [candidate(ids.third, 3), candidate(ids.second, 2)],
        skipped: [{ card_id: ids.first, reason: "NO_CANONICAL_NODE" as const }],
      };
    };
    const deps = dependencies({
      loadCandidates,
      judge: async payload => {
        payloads.push(payload);
        return answer(payload, key => key === "content_0" ? 0.82 : 0.49);
      },
    });

    const result = await evaluateJevCards({
      query: "  원래   질의 ",
      context: { agent: " Agent   A ", project: "atom", task: null },
      card_ids: [ids.first, ids.second, ids.third],
    }, deps);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.cardIds).toEqual([ids.first, ids.second, ids.third]);
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(result.query).toBe("원래 질의");
    expect(result.skipped).toEqual([{ card_id: ids.first, reason: "NO_CANONICAL_NODE" }]);
    expect(result.results).toEqual([
      expect.objectContaining({ card_id: ids.second, node_id: candidate(ids.second, 2).nodeId, card_version: 2, score: 0.82, question_key: "content_0" }),
      expect.objectContaining({ card_id: ids.third, node_id: candidate(ids.third, 3).nodeId, card_version: 3, score: 0.49, question_key: "content_1" }),
    ]);
    expect(result.results[0]?.call_id).toBe(result.results[1]?.call_id);
    expect(result.audit.calls).toHaveLength(1);
    const state = JSON.parse(payloads[0]!.state) as { user_prompt: string; session_context: unknown };
    expect(state.user_prompt).toBe("원래 질의");
    expect(JSON.stringify(state.session_context)).toContain("Agent A");
  });

  it("does not call Jev when every candidate is skipped", async () => {
    const judge = jest.fn(async (payload: JevMeaningPayload) => answer(payload, () => 0.8));
    const result = await evaluateJevCards({ query: "질의", card_ids: [ids.first] }, dependencies({
      loadCandidates: async () => ({ candidates: [], skipped: [{ card_id: ids.first, reason: "NO_BODY" }] }),
      judge,
    }));

    expect(judge).not.toHaveBeenCalled();
    expect(result.results).toEqual([]);
    expect(result.skipped).toEqual([{ card_id: ids.first, reason: "NO_BODY" }]);
    expect(result.audit.calls).toEqual([]);
  });

  it("returns a fixed configuration error without manufacturing a judgment audit", async () => {
    const judge = jest.fn(async (payload: JevMeaningPayload) => answer(payload, () => 0.8));
    let caught: unknown;
    try {
      await evaluateJevCards({ query: "질의", card_ids: [ids.first] }, dependencies({
        prepareJudge: () => { throw new JevSearchConfigError(); },
        judge,
      }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "JEV_NOT_CONFIGURED", statusCode: 503, evaluation_id: expect.any(String) });
    expect((caught as JevEvaluationRequestError).audit).toBeUndefined();
    expect(judge).not.toHaveBeenCalled();
  });

  it("rejects duplicate IDs and invalid queries with fixed request errors", async () => {
    await expect(evaluateJevCards({ query: "질의", card_ids: [ids.first, ids.first] }, dependencies()))
      .rejects.toMatchObject({ code: "JEV_EVALUATION_IDS_INVALID", statusCode: 400 });
    await expect(evaluateJevCards({ query: "   ", card_ids: [ids.first] }, dependencies()))
      .rejects.toMatchObject({ code: "JEV_QUERY_INVALID", statusCode: 400 });
  });

  it("rejects an oversized payload before calling the judge", async () => {
    const judge = jest.fn(async (payload: JevMeaningPayload) => answer(payload, () => 0.8));
    await expect(evaluateJevCards({ query: "질의", card_ids: [ids.first] }, dependencies({
      policy: { ...JEV_SEARCH_POLICY, payloadMaxChars: 1 },
      judge,
    }))).rejects.toMatchObject({ code: "JEV_EVALUATION_PAYLOAD_TOO_LARGE", statusCode: 413 });
    expect(judge).not.toHaveBeenCalled();
  });

  it("times out candidate reads and releases the shared slot", async () => {
    const policy = { ...JEV_SEARCH_POLICY, maxConcurrentRuns: 1, runTimeoutMs: 100 };
    const blocked = evaluateJevCards({ query: "질의", card_ids: [ids.first] }, dependencies({
      policy,
      loadCandidates: async (_cardIds, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    }));

    await expect(blocked).rejects.toMatchObject({ code: "JEV_EVALUATION_TIMEOUT", statusCode: 504 });
    const recovered = await evaluateJevCards({ query: "질의", card_ids: [ids.first] }, dependencies({ policy }));
    expect(recovered.results).toHaveLength(1);
  });

  it("applies no partial scores when a Jev answer is malformed and retains a sanitized audit", async () => {
    const deps = dependencies({
      loadCandidates: async () => ({ candidates: [candidate(ids.first, 1), candidate(ids.second, 2)], skipped: [] }),
      judge: async payload => ({ model: "jev-latest", answers: { content_0: { type: "noul", noul: 0.9 } }, usage: { input_tokens: 10 } }),
    });
    let caught: unknown;
    try {
      await evaluateJevCards({ query: "질의", card_ids: [ids.first, ids.second] }, deps);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(JevEvaluationRequestError);
    expect(caught).toMatchObject({ code: "BAD_NOUL_RESPONSE", statusCode: 502, audit: { calls: [{ error: { code: "BAD_NOUL_RESPONSE" } }] } });
    expect(JSON.stringify(caught)).not.toContain("TYPESAFE_API_KEY");
  });
});
