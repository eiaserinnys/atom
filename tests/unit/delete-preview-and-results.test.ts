import type { FastifyInstance } from "fastify";

import { cardRoutes } from "../../src/api/routes/cards.js";
import { treeRoutes } from "../../src/api/routes/tree.js";
import { closeDb } from "../../src/db/client.js";
import { createSymlink, getNode } from "../../src/services/tree.service.js";
import { getCard } from "../../src/services/card.service.js";
import {
  browserApp, makeCard, McpSession, openMcp, openMemoryDb, UNKNOWN_ID,
} from "./sqlite-app-harness.js";

let app: FastifyInstance;
let mcp: McpSession;

beforeAll(async () => {
  await openMemoryDb();
});
afterAll(async () => {
  await closeDb();
});
beforeEach(async () => {
  app = browserApp();
  await app.register(cardRoutes);
  await app.register(treeRoutes);
  mcp = await openMcp("write");
});
afterEach(async () => {
  await mcp.close();
  await app.close();
});

/** Sibling cards created in the same second come back in id order, so only the first (the top) is pinned. */
function topThenSorted<T extends { deleted_card_ids: string[] }>(body: T): T {
  const [top, ...rest] = body.deleted_card_ids;
  return { ...body, deleted_card_ids: [top!, ...rest.sort()] };
}

async function tree() {
  const top = await makeCard("Top");
  const child = await makeCard("Child", top.nodeId);
  const shared = await makeCard("Shared", top.nodeId);
  const elsewhere = await makeCard("Elsewhere");
  const alias = await createSymlink(shared.cardId, elsewhere.nodeId);
  return { top, child, shared, alias };
}

describe("GET /tree/:nodeId/delete-preview", () => {
  it("counts the nodes and the cards that would be deleted for a node and deletes nothing", async () => {
    const { top, child, shared, alias } = await tree();

    const res = await app.inject({ method: "GET", url: `/tree/${top.nodeId}/delete-preview` });

    expect(res.statusCode).toBe(200);
    expect(topThenSorted(res.json())).toEqual(topThenSorted({
      target: "node",
      deleted_node_count: 4,
      deleted_card_count: 3,
      deleted_card_ids: [top.cardId, child.cardId, shared.cardId],
      deleted_link_count: 1,
    }));
    expect(await getNode(top.nodeId)).not.toBeNull();
    expect(await getNode(alias.id)).not.toBeNull();
  });

  it("answers symlink for a symlink node", async () => {
    const { alias } = await tree();

    const res = await app.inject({ method: "GET", url: `/tree/${alias.id}/delete-preview` });

    expect(res.json()).toEqual({
      target: "symlink", deleted_node_count: 1, deleted_card_count: 0, deleted_card_ids: [], deleted_link_count: 0,
    });
  });

  it("answers the common 404 for an unknown node and 400 for a malformed id", async () => {
    const unknown = await app.inject({ method: "GET", url: `/tree/${UNKNOWN_ID}/delete-preview` });
    expect([unknown.statusCode, unknown.json().code]).toEqual([404, "NODE_NOT_FOUND"]);
    const malformed = await app.inject({ method: "GET", url: "/tree/not-a-uuid/delete-preview" });
    expect(malformed.statusCode).toBe(400);
  });

  it("leaves the DELETE answers at 204", async () => {
    const { top } = await tree();
    const lone = await makeCard("Lone card");
    expect((await app.inject({ method: "DELETE", url: `/tree/${top.nodeId}` })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: `/cards/${lone.cardId}` })).statusCode).toBe(204);
  });
});

describe("delete_card and delete_node answer with JSON", () => {
  it("delete_card names every card it deleted and the nodes it removed", async () => {
    const { top, child, shared, alias } = await tree();

    const result = await mcp.call("delete_card", { card_id: top.cardId });

    expect(result.isError).toBe(false);
    expect(topThenSorted(JSON.parse(result.text))).toEqual(topThenSorted({
      deleted: true,
      deleted_card_ids: [top.cardId, child.cardId, shared.cardId],
      deleted_node_count: 4,
      deleted_link_count: 1,
    }));
    expect(await getNode(alias.id)).toBeNull();
    expect(await getCard(child.cardId)).toBeNull();
  });

  it("delete_node on the canonical node takes the card and its symlink elsewhere", async () => {
    const { shared, alias } = await tree();

    const result = await mcp.call("delete_node", { node_id: shared.nodeId });

    expect(JSON.parse(result.text)).toEqual({
      deleted: true, deleted_card_ids: [shared.cardId], deleted_node_count: 2, deleted_link_count: 1,
    });
    expect(await getCard(shared.cardId)).toBeNull();
    expect(await getNode(alias.id)).toBeNull();
  });

  it("delete_node on a symlink keeps the card while it has another place", async () => {
    const { shared, alias } = await tree();

    const result = await mcp.call("delete_node", { node_id: alias.id });

    expect(JSON.parse(result.text)).toEqual({
      deleted: true, deleted_card_ids: [], deleted_node_count: 1, deleted_link_count: 0,
    });
    expect(await getCard(shared.cardId)).not.toBeNull();
    expect(await getNode(shared.nodeId)).not.toBeNull();
  });

  it.each([
    ["delete_card", (t: Awaited<ReturnType<typeof tree>>) => ({ card_id: t.top.cardId })],
    ["delete_node", (t: Awaited<ReturnType<typeof tree>>) => ({ node_id: t.top.nodeId })],
  ] as const)("%s with dry_run reports the same lists and deletes nothing", async (name, args) => {
    const t = await tree();

    const dry = await mcp.call(name, { ...args(t), dry_run: true });

    expect(dry.isError).toBe(false);
    expect(topThenSorted(JSON.parse(dry.text))).toEqual(topThenSorted({
      deleted: false,
      deleted_card_ids: [t.top.cardId, t.child.cardId, t.shared.cardId],
      deleted_node_count: 4,
      deleted_link_count: 1,
      dry_run: true,
    }));
    expect(await getCard(t.top.cardId)).not.toBeNull();
    expect(await getCard(t.child.cardId)).not.toBeNull();
    expect(await getNode(t.top.nodeId)).not.toBeNull();

    const real = await mcp.call(name, { ...args(t), dry_run: false });
    expect(topThenSorted(JSON.parse(real.text))).toEqual(topThenSorted({
      deleted: true,
      deleted_card_ids: [t.top.cardId, t.child.cardId, t.shared.cardId],
      deleted_node_count: 4,
      deleted_link_count: 1,
    }));
    expect(await getCard(t.top.cardId)).toBeNull();
    expect(await getNode(t.alias.id)).toBeNull();
  });

  it("keeps the not-found errors for a dry run too", async () => {
    const t = await tree();
    expect((await mcp.call("delete_card", { card_id: UNKNOWN_ID, dry_run: true })).text)
      .toBe(`Card not found: ${UNKNOWN_ID}`);
    expect((await mcp.call("delete_node", { node_id: t.top.cardId, dry_run: true })).isError).toBe(true);
  });

  it("a read key still does not see the delete tools", async () => {
    const read = await openMcp("read");
    try {
      const names = (await read.client.listTools()).tools.map((tool) => tool.name);
      expect(names).not.toContain("delete_card");
      expect(names).not.toContain("delete_node");
    } finally {
      await read.close();
    }
  });
});
