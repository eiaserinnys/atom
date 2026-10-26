import Fastify from "fastify";
import type { QueryExpansionResponse } from "../../src/shared/query-expansion.js";
import { createSearchExpandRoutes } from "../../src/api/routes/search-expand.js";

const uuid = "10000000-0000-4000-8000-000000000001";

function makeApp(role: "admin" | "editor" | "viewer" | null, expand: (...args: any[]) => Promise<any>) {
  const app = Fastify({ logger: false });
  app.addHook("preHandler", async req => {
    if (role) req.jwtUser = { id: "user", email: "user@example.test", name: "User", role };
  });
  app.register(createSearchExpandRoutes({ expand } as never));
  return app;
}

const readyBody: QueryExpansionResponse = {
  status: "ready",
  model: "text-embedding-3-large",
  dimensions: 3072,
  key_configured: true,
  index: { indexed_cards: 1 },
  query: { text: "query", token_count: 1, truncated: false },
  neighbors: [],
};

describe("POST /search/expand", () => {
  it("normalizes query, defaults exclusions, deduplicates IDs, and preserves service status bodies", async () => {
    const calls: unknown[][] = [];
    const app = makeApp("viewer", async (...args) => {
      calls.push(args);
      return { statusCode: 200, body: readyBody };
    });
    const response = await app.inject({
      method: "POST",
      url: "/search/expand",
      payload: { query: "  two   words  ", exclude_card_ids: [uuid, uuid], limit: 12 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(readyBody);
    expect(calls[0]?.[0]).toMatchObject({ query: "two words", exclude_card_ids: [uuid], limit: 12 });
    expect(calls[0]?.[1]).toBeInstanceOf(AbortSignal);
    await app.close();

    const defaultApp = makeApp("viewer", async (...args) => {
      calls.push(args);
      return { statusCode: 202, body: { status: "loading", retry_after_ms: 1000 } };
    });
    const loading = await defaultApp.inject({ method: "POST", url: "/search/expand", payload: { query: "query" } });
    expect(loading.statusCode).toBe(202);
    expect(loading.headers["retry-after"]).toBe("1");
    expect(loading.json()).toEqual({ status: "loading", retry_after_ms: 1000 });
    expect(calls.at(-1)?.[0]).toMatchObject({ query: "query", exclude_card_ids: [], limit: 12 });
    await defaultApp.close();
  });

  it("allows authenticated viewer roles and keeps a 409 response intact", async () => {
    for (const role of ["viewer", "editor", "admin"] as const) {
      const app = makeApp(role, async () => ({
        statusCode: 409,
        body: { error: { code: "EMBEDDING_NOT_READY", reason: "no_key" }, key_configured: false },
      }));
      const response = await app.inject({ method: "POST", url: "/search/expand", payload: { query: "query" } });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: { code: "EMBEDDING_NOT_READY", reason: "no_key" }, key_configured: false });
      await app.close();
    }

    const unauthenticated = makeApp(null, async () => ({ statusCode: 200, body: readyBody }));
    expect((await unauthenticated.inject({ method: "POST", url: "/search/expand", payload: { query: "query" } })).statusCode).toBe(401);
    await unauthenticated.close();
  });

  it("rejects invalid query, UUIDs, and limits with fixed codes before calling the service", async () => {
    let calls = 0;
    const app = makeApp("viewer", async () => { calls += 1; return { statusCode: 200, body: readyBody }; });
    const cases = [
      [{ query: "  " }, "QUERY_EXPANSION_INPUT_INVALID"],
      [{ query: "x".repeat(401) }, "QUERY_EXPANSION_INPUT_INVALID"],
      [{ query: "query", exclude_card_ids: ["not-a-uuid"] }, "QUERY_EXPANSION_INPUT_INVALID"],
      [{ query: "query", limit: 51 }, "NEIGHBOR_LIMIT_INVALID"],
      [{ query: "query", limit: 1.5 }, "NEIGHBOR_LIMIT_INVALID"],
    ] as const;
    for (const [payload, code] of cases) {
      const response = await app.inject({ method: "POST", url: "/search/expand", payload });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe(code);
    }
    expect(calls).toBe(0);
    const invalidJson = await app.inject({
      method: "POST", url: "/search/expand", headers: { "content-type": "application/json" }, payload: "{invalid-json",
    });
    expect(invalidJson.statusCode).toBe(400);
    expect(invalidJson.body).not.toContain("invalid-json");
    await app.close();
  });
});
