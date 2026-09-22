/**
 * Agent key verification cache through the real routes — Postgres.
 *
 * /api/* (card API preHandler) and /mcp share one verifier: bcrypt runs once
 * per key, later requests only re-read the active agents. Rotation and
 * deactivation through /api/config/agents take effect immediately.
 *
 * Requires TEST_DATABASE_URL to point to a test PostgreSQL database.
 */
import Fastify, { type FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { jest } from "@jest/globals";

import { getIntegrationTestPool, setupIntegrationTestDb } from "./integration-harness.js";
import { agentKeyVerifier } from "../../src/api/agent-key-auth.js";
import { cardApiRoutes } from "../../src/api/routes/card_api.js";
import { configRoutes } from "../../src/api/routes/config.js";
import { mcpRoutes } from "../../src/api/routes/mcp.js";
import { insertAgent, type Agent } from "../../src/db/queries/agents.js";

setupIntegrationTestDb();

// Production cost, so the cold/warm latency gap below is the real one.
const BCRYPT_COST = 10;
const SECRET = "agent-key-cache-secret";

let app: FastifyInstance;
let agent: Agent;
let compareSpy: ReturnType<typeof jest.spyOn>;

beforeEach(async () => {
  agentKeyVerifier.clear();
  agent = await insertAgent(getIntegrationTestPool(), {
    agent_id: "cache-test",
    secret_hash: await bcrypt.hash(SECRET, BCRYPT_COST),
  });
  app = Fastify({ logger: false });
  // Stand-in for authMiddleware: config routes only need an admin jwtUser.
  app.addHook("preHandler", async (req) => {
    req.jwtUser = { id: "bypass", email: "bypass@local", name: "Test Admin", role: "admin" };
  });
  await app.register(cardApiRoutes);
  await app.register(configRoutes);
  await app.register(mcpRoutes);
  // /mcp runs over a real socket: the MCP transport drains the raw request
  // stream and, under inject's fake socket, leaves a timer that crashes later.
  await app.listen({ port: 0, host: "127.0.0.1" });
  compareSpy = jest.spyOn(bcrypt, "compare");
});

afterEach(async () => {
  compareSpy.mockRestore();
  await app.close();
});

function getTree(key: string) {
  return app.inject({ method: "GET", url: "/api/tree", headers: { "x-api-key": key } });
}

async function postMcp(key: string): Promise<{ statusCode: number }> {
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("server is not listening on TCP");
  const res = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "cache-test", version: "0" },
      },
    }),
  });
  await res.text();
  return { statusCode: res.status };
}

describe("agent key verification cache", () => {
  it("runs bcrypt on the first request only", async () => {
    expect((await getTree(SECRET)).statusCode).toBe(200);
    expect(compareSpy).toHaveBeenCalledTimes(1);

    compareSpy.mockClear();
    expect((await getTree(SECRET)).statusCode).toBe(200);
    expect(compareSpy).toHaveBeenCalledTimes(0);
  });

  it("shares the verified key with the MCP endpoint", async () => {
    expect((await postMcp(SECRET)).statusCode).toBe(200);
    expect(compareSpy).toHaveBeenCalledTimes(1);

    compareSpy.mockClear();
    expect((await getTree(SECRET)).statusCode).toBe(200);
    expect((await postMcp(SECRET)).statusCode).toBe(200);
    expect(compareSpy).toHaveBeenCalledTimes(0);
  });

  it("rejects a wrong key every time and never caches it", async () => {
    expect((await getTree("wrong-secret")).statusCode).toBe(401);
    expect((await postMcp("wrong-secret")).statusCode).toBe(401);
    expect(compareSpy).toHaveBeenCalledTimes(2);

    compareSpy.mockClear();
    expect((await getTree("wrong-secret")).statusCode).toBe(401);
    expect(compareSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects the old key after reissue and accepts the new one", async () => {
    expect((await getTree(SECRET)).statusCode).toBe(200);

    const clearSpy = jest.spyOn(agentKeyVerifier, "clear");
    const reissue = await app.inject({
      method: "POST",
      url: `/api/config/agents/${agent.id}/reissue`,
    });
    expect(reissue.statusCode).toBe(200);
    expect(clearSpy).toHaveBeenCalledTimes(1);
    clearSpy.mockRestore();
    const newSecret = reissue.json<{ secret: string }>().secret;

    expect((await getTree(SECRET)).statusCode).toBe(401);
    expect((await postMcp(SECRET)).statusCode).toBe(401);
    expect((await getTree(newSecret)).statusCode).toBe(200);

    compareSpy.mockClear();
    expect((await getTree(newSecret)).statusCode).toBe(200);
    expect(compareSpy).toHaveBeenCalledTimes(0);
  });

  it("rejects a cached key once the agent is deactivated", async () => {
    expect((await getTree(SECRET)).statusCode).toBe(200);

    const clearSpy = jest.spyOn(agentKeyVerifier, "clear");
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/config/agents/${agent.id}`,
      payload: { is_active: false },
    });
    expect(patch.statusCode).toBe(200);
    expect(clearSpy).toHaveBeenCalledTimes(1);
    clearSpy.mockRestore();

    expect((await getTree(SECRET)).statusCode).toBe(401);
    expect((await postMcp(SECRET)).statusCode).toBe(401);
  });

  it("rejects a cached key deactivated behind the API's back (DB cross-check)", async () => {
    expect((await getTree(SECRET)).statusCode).toBe(200);
    await getIntegrationTestPool().query(`UPDATE agents SET is_active = false WHERE id = $1`, [agent.id]);
    expect((await getTree(SECRET)).statusCode).toBe(401);
  });

  it("clears the cache when an agent is created", async () => {
    const clearSpy = jest.spyOn(agentKeyVerifier, "clear");
    const created = await app.inject({
      method: "POST",
      url: "/api/config/agents",
      payload: { agent_id: "cache-test-2" },
    });
    expect(created.statusCode).toBe(201);
    expect(clearSpy).toHaveBeenCalledTimes(1);
    clearSpy.mockRestore();
    expect((await getTree(created.json<{ secret: string }>().secret)).statusCode).toBe(200);
  });

  it("keeps warm-key latency under 20ms at p50", async () => {
    const t0 = performance.now();
    expect((await getTree(SECRET)).statusCode).toBe(200);
    const cold = performance.now() - t0;

    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      const start = performance.now();
      expect((await getTree(SECRET)).statusCode).toBe(200);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(samples.length / 2)]!;
    if (process.env["AGENT_KEY_CACHE_TIMING"]) {
      console.log(`agent key cache: cold=${cold.toFixed(1)}ms warm p50=${p50.toFixed(2)}ms max=${samples.at(-1)!.toFixed(2)}ms`);
    }
    expect(p50).toBeLessThan(20);
  });
});
