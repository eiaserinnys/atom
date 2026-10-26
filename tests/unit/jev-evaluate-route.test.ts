import Fastify from "fastify";
import { createSearchEvaluateRoutes, type SearchEvaluateHandlerDependencies } from "../../src/api/routes/search-evaluate.js";
import { JevEvaluationRequestError } from "../../src/services/jev-search/evaluate.js";
import type { JevEvaluationResponse } from "../../src/shared/visual-search.js";

const requestBody = {
  query: "원래 질의",
  context: { agent: "roselin", project: "atom", task: null },
  card_ids: ["10000000-0000-4000-8000-000000000001"],
};

function response(): JevEvaluationResponse {
  return {
    evaluation_id: "20000000-0000-4000-8000-000000000001",
    query: "원래 질의",
    model: "jev-latest",
    results: [],
    skipped: [],
    audit: { calls: [] },
  };
}

function makeApp(dependencies: SearchEvaluateHandlerDependencies, role?: "viewer" | "editor" | "admin") {
  const app = Fastify({ logger: false });
  if (role) {
    app.addHook("preHandler", async request => {
      request.jwtUser = { id: role, email: `${role}@example.test`, name: role, role };
    });
  }
  app.register(createSearchEvaluateRoutes(dependencies));
  return app;
}

describe("Jev evaluation REST boundary", () => {
  it("allows a logged-in viewer and passes the original input with a cancellation signal", async () => {
    const calls: Array<{ input: unknown; signal: AbortSignal }> = [];
    const app = makeApp({ evaluate: async (input, signal) => { calls.push({ input, signal }); return response(); } }, "viewer");
    const res = await app.inject({ method: "POST", url: "/search/evaluate", payload: requestBody });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(response());
    expect(calls).toEqual([{ input: requestBody, signal: expect.any(AbortSignal) }]);
    await app.close();
  });

  it("requires a JWT role and ignores an agent key header", async () => {
    const app = makeApp({ evaluate: async () => response() });
    const res = await app.inject({
      method: "POST",
      url: "/search/evaluate",
      headers: { "x-api-key": "agent-key-only" },
      payload: requestBody,
    });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("returns fixed input and service error codes", async () => {
    const app = makeApp({ evaluate: async input => {
      if (input.card_ids.length === 0) throw new JevEvaluationRequestError("Evaluation card_ids must contain 1 to 48 unique UUIDs.", "JEV_EVALUATION_IDS_INVALID", 400);
      throw new JevEvaluationRequestError("Jev evaluation is busy.", "JEV_EVALUATION_BUSY", 429);
    } }, "viewer");
    const busy = await app.inject({ method: "POST", url: "/search/evaluate", payload: requestBody });
    expect(busy.statusCode).toBe(429);
    expect(busy.json()).toEqual({ error: { code: "JEV_EVALUATION_BUSY", message: "Jev evaluation is busy." } });

    const invalid = await app.inject({ method: "POST", url: "/search/evaluate", payload: { query: "질의", card_ids: [] } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("JEV_EVALUATION_IDS_INVALID");
    await app.close();
  });

  it("maps malformed JSON to the fixed evaluation input error", async () => {
    const app = makeApp({ evaluate: async () => response() }, "viewer");
    const res = await app.inject({ method: "POST", url: "/search/evaluate", headers: { "content-type": "application/json" }, payload: "{" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: { code: "JEV_EVALUATION_INPUT_INVALID", message: "Evaluation request must be valid JSON." } });
    await app.close();
  });

  it("aborts evaluation when the HTTP client disconnects", async () => {
    let entered!: () => void;
    let aborted!: () => void;
    const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
    const abortedPromise = new Promise<void>(resolve => { aborted = resolve; });
    const app = makeApp({
      evaluate: async (_input, signal) => {
        entered();
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => { aborted(); reject(new Error("aborted")); }, { once: true });
        });
        return response();
      },
    }, "viewer");
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (address === null || typeof address === "string") throw new Error("server is not listening on TCP");
    const controller = new AbortController();
    const request = fetch(`http://127.0.0.1:${address.port}/search/evaluate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    }).catch(() => undefined);

    await enteredPromise;
    controller.abort();
    await abortedPromise;
    await request;
    await app.close();
  });
});
