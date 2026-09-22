/**
 * GET /api/tree/outline (agent key) and GET /tree/outline (dashboard) —
 * Postgres contract.
 *
 * Requires TEST_DATABASE_URL to point to a test PostgreSQL database.
 */
import Fastify, { type FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";

import { getIntegrationTestPool, setupIntegrationTestDb } from "./integration-harness.js";
import {
  EXPECTED_EXCERPTS_UNDER_R_DEPTH_2,
  excerptsOf,
  expectedUnderR,
  expectNoBodies,
  LONG_BODY,
  seedCard,
  seedOutlineFixture,
  shapeOf,
  type OutlineFixture,
} from "./tree-outline-fixtures.js";
import { cardApiRoutes } from "../../src/api/routes/card_api.js";
import { treeRoutes } from "../../src/api/routes/tree.js";
import { insertAgent } from "../../src/db/queries/agents.js";
import { setDb } from "../../src/db/client.js";
import type { DatabaseAdapter } from "../../src/db/adapter.js";
import * as treeService from "../../src/services/tree.service.js";
import type { TreeOutline } from "../../src/shared/types.js";

setupIntegrationTestDb();

const API_KEY = "outline-test-secret";

let fx: OutlineFixture;
let app: FastifyInstance;

beforeEach(async () => {
  fx = await seedOutlineFixture();
  await insertAgent(getIntegrationTestPool(), {
    agent_id: "outline-test",
    secret_hash: await bcrypt.hash(API_KEY, 4),
  });
  app = Fastify({ logger: false });
  await app.register(cardApiRoutes);
  await app.register(treeRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

async function outline(query: string): Promise<TreeOutline> {
  const res = await app.inject({
    method: "GET",
    url: `/api/tree/outline${query}`,
    headers: { "x-api-key": API_KEY },
  });
  expect(res.statusCode).toBe(200);
  return res.json<TreeOutline>();
}

describe("GET /api/tree/outline", () => {
  it("requires the agent key", async () => {
    const res = await app.inject({ method: "GET", url: `/api/tree/outline?node_id=${fx.R}` });
    expect(res.statusCode).toBe(401);
  });

  it.each([1, 2, 3] as const)(
    "depth=%i expands children only to the limit and counts the rest",
    async (depth) => {
      const body = await outline(`?node_id=${fx.R}&depth=${depth}`);
      expect(body.node_id).toBe(fx.R);
      expect(body.canonical_node_id).toBe(fx.R);
      expect(body.depth).toBe(depth);
      expect(shapeOf(body.nodes)).toEqual(expectedUnderR(depth));
      expectNoBodies(body);
    }
  );

  it("defaults to depth 2", async () => {
    const body = await outline(`?node_id=${fx.R}`);
    expect(body.depth).toBe(2);
    expect(shapeOf(body.nodes)).toEqual(expectedUnderR(2));
  });

  it("counts descendants below the depth limit (depth-4 node under a depth-2 request)", async () => {
    const body = await outline(`?node_id=${fx.R}&depth=2`);
    const a = body.nodes.find((n) => n.id === fx.A)!;
    const a1 = a.children.find((n) => n.id === fx.A1)!;
    // A1 → A1a → A1ai: both are below the depth-2 horizon yet counted.
    expect(a1.children).toEqual([]);
    expect(a1.child_count).toBe(1);
    expect(a1.descendant_count).toBe(2);
    expect(a.descendant_count).toBe(4);
  });

  it("carries node and card identity fields", async () => {
    const body = await outline(`?node_id=${fx.R}&depth=1`);
    const [a, b, s] = body.nodes;
    expect(a).toMatchObject({
      id: fx.A,
      parent_node_id: fx.R,
      is_symlink: false,
      title: "A",
      card_type: "structure",
    });
    expect(typeof a!.card_id).toBe("string");
    expect(typeof a!.position).toBe("number");
    expect(a!.position).toBeLessThan(b!.position);
    expect(b!.position).toBeLessThan(s!.position);
    expect(s).toMatchObject({ id: fx.S, is_symlink: true, card_type: "structure", children: [] });
  });

  it("lists the virtual root when node_id is omitted", async () => {
    const body = await outline("?depth=1");
    expect(body.node_id).toBeNull();
    expect(body.canonical_node_id).toBeNull();
    expect(shapeOf(body.nodes)).toEqual([
      // R: A, A1, A1a, A1ai, A2, B, S
      { title: "R", child_count: 3, descendant_count: 7, is_symlink: false, children: [] },
      { title: "X", child_count: 2, descendant_count: 2, is_symlink: false, children: [] },
    ]);
    expect(body.nodes.map((n) => n.parent_node_id)).toEqual([null, null]);
  });

  it("resolves a symlink node_id to its canonical node's children", async () => {
    const body = await outline(`?node_id=${fx.S}&depth=2`);
    expect(body.node_id).toBe(fx.S);
    expect(body.canonical_node_id).toBe(fx.X);
    expect(body.nodes.map((n) => n.id)).toEqual([fx.X1, fx.X2]);
    expect(body.nodes.map((n) => n.parent_node_id)).toEqual([fx.X, fx.X]);
  });

  it("returns 404 for an unknown node", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/tree/outline?node_id=6f1f7c2e-8a3b-4c5d-9e0f-112233445566",
      headers: { "x-api-key": API_KEY },
    });
    expect(res.statusCode).toBe(404);
  });

  it.each(["0", "4"])("rejects depth=%s with 400", async (depth) => {
    const res = await app.inject({
      method: "GET",
      url: `/api/tree/outline?node_id=${fx.R}&depth=${depth}`,
      headers: { "x-api-key": API_KEY },
    });
    expect(res.statusCode).toBe(400);
  });

  it("issues a constant number of queries regardless of subtree size (no N+1)", async () => {
    const pool = getIntegrationTestPool();
    let queries = 0;
    const counting = new Proxy(pool, {
      get(target, prop, receiver) {
        if (prop === "query") {
          return (...args: Parameters<DatabaseAdapter["query"]>) => {
            queries += 1;
            return target.query(...args);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as DatabaseAdapter;

    const countFor = async (nodeId: string | null): Promise<number> => {
      setDb(counting);
      queries = 0;
      try {
        await treeService.getTreeOutline(nodeId, 3, 0);
      } finally {
        setDb(pool);
      }
      return queries;
    };

    const small = { node: await countFor(fx.R), root: await countFor(null), symlink: await countFor(fx.S) };

    // Grow the tree under R by 40 more nodes spread over three levels.
    for (let i = 0; i < 10; i++) {
      const c = (await seedCard(`C${i}`, fx.R, "structure")).nodeId;
      const g = (await seedCard(`G${i}`, c)).nodeId;
      await seedCard(`H${i}a`, g);
      await seedCard(`H${i}b`, g);
    }

    const large = { node: await countFor(fx.R), root: await countFor(null), symlink: await countFor(fx.S) };

    expect(large).toEqual(small);
    expect(small.root).toBe(1);
    expect(small.node).toBeLessThanOrEqual(2);
    expect(small.symlink).toBeLessThanOrEqual(3);
  });
});

describe("GET /api/tree/outline?excerpt_chars", () => {
  it("excerpt_chars=0 keeps the body-free contract byte for byte", async () => {
    const plain = await outline(`?node_id=${fx.R}&depth=3`);
    const zero = await outline(`?node_id=${fx.R}&depth=3&excerpt_chars=0`);
    expect(zero).toEqual(plain);
    expectNoBodies(zero);
  });

  it("excerpt_chars=200 adds an excerpt to every node, depth-2 children included", async () => {
    const body = await outline(`?node_id=${fx.R}&depth=2&excerpt_chars=200`);
    expect(excerptsOf(body.nodes)).toEqual(EXPECTED_EXCERPTS_UNDER_R_DEPTH_2);
    expect(shapeOf(body.nodes)).toEqual(expectedUnderR(2));
  });

  it.each([
    [200, `Long card ${"word ".repeat(38).trimEnd()}…`],
    [400, `Long card ${"word ".repeat(78).trimEnd()}…`],
  ])("excerpt_chars=%i cuts a long body and never ships it whole", async (chars, expected) => {
    const long = await seedCard("Long", fx.B, "knowledge", LONG_BODY);
    const body = await outline(`?node_id=${fx.B}&depth=1&excerpt_chars=${chars}`);
    expect(body.nodes.find((n) => n.id === long.nodeId)!.excerpt).toBe(expected);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("TAIL-MARKER");
    expect(serialized).not.toContain("hidden");
  });

  it("returns a null excerpt for a card without content", async () => {
    const empty = await seedCard("Empty", fx.B, "knowledge", null);
    const body = await outline(`?node_id=${fx.B}&depth=1&excerpt_chars=200`);
    expect(body.nodes.find((n) => n.id === empty.nodeId)!.excerpt).toBeNull();
  });

  it.each(["401", "-1"])("rejects excerpt_chars=%s with 400", async (chars) => {
    const res = await app.inject({
      method: "GET",
      url: `/api/tree/outline?node_id=${fx.R}&excerpt_chars=${chars}`,
      headers: { "x-api-key": API_KEY },
    });
    expect(res.statusCode).toBe(400);
  });

  it("the dashboard route serves the same excerpts", async () => {
    const agent = await outline(`?node_id=${fx.R}&depth=2&excerpt_chars=200`);
    const res = await app.inject({ method: "GET", url: `/tree/outline?node_id=${fx.R}&depth=2&excerpt_chars=200` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(agent);
  });
});

describe("GET /tree/outline (dashboard route)", () => {
  it("serves the same outline as the agent route", async () => {
    const agent = await outline(`?node_id=${fx.R}&depth=3`);
    const res = await app.inject({ method: "GET", url: `/tree/outline?node_id=${fx.R}&depth=3` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(agent);
  });

  it("does not shadow GET /tree/:nodeId", async () => {
    const res = await app.inject({ method: "GET", url: `/tree/${fx.R}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(fx.R);
  });

  it("validates the query the same way", async () => {
    const res = await app.inject({ method: "GET", url: "/tree/outline?depth=4" });
    expect(res.statusCode).toBe(400);
  });
});
