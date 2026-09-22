/**
 * GET /api/tree/outline — query boundary contract (no DB).
 *
 * The handler validates `node_id` / `depth` at the REST boundary and passes
 * trusted values to the service. The service is faked so these cases stay
 * independent of any adapter.
 */
import Fastify from "fastify";

import { createTreeOutlineHandler } from "../../src/api/routes/tree-outline.js";
import type { TreeOutline } from "../../src/shared/types.js";

const NODE_ID = "0b6a3b3c-5d7e-4f10-9a2b-3c4d5e6f7a8b";

function makeApp(result: TreeOutline | null = null) {
  const calls: Array<{ nodeId: string | null; depth: number }> = [];
  const app = Fastify({ logger: false });
  app.get(
    "/api/tree/outline",
    createTreeOutlineHandler({
      getTreeOutline: async (nodeId, depth) => {
        calls.push({ nodeId, depth });
        return result === null
          ? null
          : { ...result, node_id: nodeId, depth };
      },
    })
  );
  return { app, calls };
}

const EMPTY: TreeOutline = { node_id: null, canonical_node_id: null, depth: 2, nodes: [] };

describe("tree outline route boundary", () => {
  it("defaults to the virtual root and depth 2", async () => {
    const { app, calls } = makeApp(EMPTY);
    const res = await app.inject({ method: "GET", url: "/api/tree/outline" });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([{ nodeId: null, depth: 2 }]);
    expect(res.json()).toEqual({ node_id: null, canonical_node_id: null, depth: 2, nodes: [] });
  });

  it.each([1, 2, 3])("accepts depth=%i", async (depth) => {
    const { app, calls } = makeApp(EMPTY);
    const res = await app.inject({
      method: "GET",
      url: `/api/tree/outline?node_id=${NODE_ID}&depth=${depth}`,
    });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([{ nodeId: NODE_ID, depth }]);
  });

  it.each(["0", "4", "-1", "1.5", "2x", "", "abc", "02"])(
    "rejects depth=%p with 400 before touching the service",
    async (depth) => {
      const { app, calls } = makeApp(EMPTY);
      const res = await app.inject({
        method: "GET",
        url: `/api/tree/outline?depth=${encodeURIComponent(depth)}`,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/depth/);
      expect(calls).toEqual([]);
    }
  );

  it.each(["not-a-uuid", "", "0b6a3b3c5d7e4f109a2b3c4d5e6f7a8b"])(
    "rejects node_id=%p with 400 before touching the service",
    async (nodeId) => {
      const { app, calls } = makeApp(EMPTY);
      const res = await app.inject({
        method: "GET",
        url: `/api/tree/outline?node_id=${encodeURIComponent(nodeId)}`,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/node_id/);
      expect(calls).toEqual([]);
    }
  );

  it("rejects a repeated node_id with 400", async () => {
    const { app, calls } = makeApp(EMPTY);
    const res = await app.inject({
      method: "GET",
      url: `/api/tree/outline?node_id=${NODE_ID}&node_id=${NODE_ID}`,
    });
    expect(res.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it("returns 404 when the node does not exist", async () => {
    const { app, calls } = makeApp(null);
    const res = await app.inject({
      method: "GET",
      url: `/api/tree/outline?node_id=${NODE_ID}`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Node not found" });
    expect(calls).toEqual([{ nodeId: NODE_ID, depth: 2 }]);
  });
});
