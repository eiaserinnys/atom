import path from "node:path";
import { fileURLToPath } from "node:url";

import { closeDb, getDb, runMigrations, setDb } from "../../src/db/client.js";
import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import { selectNodeById } from "../../src/db/queries/tree.js";
import { eventBus, type AtomEvent } from "../../src/events/eventBus.js";
import { executeBatchOp } from "../../src/services/batch.service.js";
import { createCard } from "../../src/services/card.service.js";
import { compileSubtree, createSymlink, listChildren, moveNode } from "../../src/services/tree.service.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS_DIR = path.join(root, "src/db/migrations-sqlite");

beforeEach(async () => {
  setDb(new SqliteAdapter(":memory:"));
  await runMigrations(MIGRATIONS_DIR);
});

afterEach(async () => {
  await closeDb();
});

async function parentAndAlias(): Promise<{ parentNodeId: string; aliasNodeId: string }> {
  const { card, node_id: parentNodeId } = await createCard({
    card_type: "structure",
    title: "Canonical parent",
  });
  const alias = await createSymlink(card.id, null);
  return { parentNodeId, aliasNodeId: alias.id };
}

async function collectEvents<T>(run: () => Promise<T>): Promise<{ result: T; events: AtomEvent[] }> {
  const events: AtomEvent[] = [];
  const listener = (event: AtomEvent) => events.push(event);
  eventBus.on("atom:event", listener);
  try {
    return { result: await run(), events };
  } finally {
    eventBus.off("atom:event", listener);
  }
}

async function expectVisibleThroughParent(
  parentNodeId: string,
  aliasNodeId: string,
  title: string
): Promise<void> {
  for (const nodeId of [aliasNodeId, parentNodeId]) {
    expect((await listChildren(nodeId)).map((node) => node.card.title)).toContain(title);
    expect((await compileSubtree(nodeId, Infinity, { titlesOnly: true }, false)).markdown)
      .toContain(title);
  }
}

describe("U3 tree parent normalization on SQLite", () => {
  it("stores a created card under the canonical parent and keeps alias reads coherent", async () => {
    const { parentNodeId, aliasNodeId } = await parentAndAlias();
    const { result: created, events } = await collectEvents(() =>
      createCard({
        card_type: "knowledge",
        title: "Created through alias",
        parent_node_id: aliasNodeId,
      })
    );

    expect((await selectNodeById(getDb(), created.node_id))?.parent_node_id).toBe(parentNodeId);
    await expectVisibleThroughParent(parentNodeId, aliasNodeId, "Created through alias");
    expect(events.find((event) => event.type === "card:created" && event.nodeId === created.node_id))
      .toMatchObject({ parentNodeId });
  });

  it("stores a single move under the canonical parent and emits that parent", async () => {
    const { parentNodeId, aliasNodeId } = await parentAndAlias();
    const moving = await createCard({ card_type: "knowledge", title: "Single move" });
    const { result, events } = await collectEvents(() =>
      moveNode(moving.node_id, { parent_node_id: aliasNodeId })
    );

    expect(result.node?.parent_node_id).toBe(parentNodeId);
    expect((await selectNodeById(getDb(), moving.node_id))?.parent_node_id).toBe(parentNodeId);
    await expectVisibleThroughParent(parentNodeId, aliasNodeId, "Single move");
    expect(events.find((event) => event.type === "node:moved" && event.nodeId === moving.node_id))
      .toMatchObject({ newParentNodeId: parentNodeId });
  });

  it("normalizes batch create parents in stored rows and patches", async () => {
    const { parentNodeId, aliasNodeId } = await parentAndAlias();
    const { result, events } = await collectEvents(() =>
      executeBatchOp({
        creates: [{
          temp_id: "u3-created",
          card_type: "knowledge",
          title: "Batch create through alias",
          parent_node_id: aliasNodeId,
        }],
      })
    );
    const created = result.created[0];

    expect((await selectNodeById(getDb(), created.node_id))?.parent_node_id).toBe(parentNodeId);
    await expectVisibleThroughParent(parentNodeId, aliasNodeId, "Batch create through alias");
    expect(events.find((event) => event.type === "batch:completed"))
      .toMatchObject({
        patches: expect.arrayContaining([
          expect.objectContaining({ type: "card:created", nodeId: created.node_id, parentNodeId }),
        ]),
      });
  });

  it("normalizes batch move parents in stored rows and patches", async () => {
    const { parentNodeId, aliasNodeId } = await parentAndAlias();
    const moving = await createCard({ card_type: "knowledge", title: "Batch move" });
    const { events } = await collectEvents(() =>
      executeBatchOp({
        moves: [{ node_id: moving.node_id, new_parent_node_id: aliasNodeId }],
      })
    );

    expect((await selectNodeById(getDb(), moving.node_id))?.parent_node_id).toBe(parentNodeId);
    await expectVisibleThroughParent(parentNodeId, aliasNodeId, "Batch move");
    expect(events.find((event) => event.type === "batch:completed"))
      .toMatchObject({
        patches: expect.arrayContaining([
          expect.objectContaining({ type: "node:moved", nodeId: moving.node_id, newParentNodeId: parentNodeId }),
        ]),
      });
  });

  it("normalizes batch symlink parents in stored rows and patches", async () => {
    const { card: parentCard } = await createCard({ card_type: "structure", title: "Canonical parent" });
    const parentNodeId = (await getDb().query(
      "SELECT id FROM tree_nodes WHERE card_id = $1 AND is_symlink = $2",
      [parentCard.id, false]
    )).rows[0].id as string;
    const alias = await createSymlink(parentCard.id, null);
    const target = await createCard({ card_type: "knowledge", title: "Symlink target" });
    const { result, events } = await collectEvents(() =>
      executeBatchOp({
        symlinks: [{ card_id: target.card.id, parent_node_id: alias.id }],
      })
    );
    const symlinkNodeId = result.symlinked[0];

    expect((await selectNodeById(getDb(), symlinkNodeId))?.parent_node_id).toBe(parentNodeId);
    await expectVisibleThroughParent(parentNodeId, alias.id, "Symlink target");
    expect(events.find((event) => event.type === "batch:completed"))
      .toMatchObject({
        patches: expect.arrayContaining([
          expect.objectContaining({ type: "node:created", nodeId: symlinkNodeId, parentNodeId }),
        ]),
      });
  });

  it("normalizes child_orders parents, results, and patches", async () => {
    const { parentNodeId, aliasNodeId } = await parentAndAlias();
    const moving = await createCard({ card_type: "knowledge", title: "Child order move" });
    const { result, events } = await collectEvents(() =>
      executeBatchOp({
        child_orders: [{ parent_node_id: aliasNodeId, order: [moving.node_id] }],
      })
    );

    expect((await selectNodeById(getDb(), moving.node_id))?.parent_node_id).toBe(parentNodeId);
    await expectVisibleThroughParent(parentNodeId, aliasNodeId, "Child order move");
    expect(result.child_ordered).toEqual([parentNodeId]);
    expect(events.find((event) => event.type === "batch:completed"))
      .toMatchObject({
        patches: expect.arrayContaining([
          expect.objectContaining({ type: "node:moved", nodeId: moving.node_id, newParentNodeId: parentNodeId }),
        ]),
      });
  });

  it("rejects moving the canonical node under its own alias after normalization", async () => {
    const { parentNodeId, aliasNodeId } = await parentAndAlias();

    await expect(moveNode(parentNodeId, { parent_node_id: aliasNodeId }))
      .rejects.toMatchObject({ code: "TREE_CYCLE", statusCode: 400 });
  });
});
