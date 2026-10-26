import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import { closeDb, runMigrations, setDb } from "../../src/db/client.js";
import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import * as cardService from "../../src/services/card.service.js";
import * as treeService from "../../src/services/tree.service.js";
import { executeBatchOp } from "../../src/services/batch.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations-sqlite");
let dbPath: string;

beforeEach(async () => {
  dbPath = path.join(os.tmpdir(), `atom-deletions-${crypto.randomUUID()}.db`);
  setDb(new SqliteAdapter(dbPath));
  await runMigrations(MIGRATIONS_DIR);
});

afterEach(async () => {
  await closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
});

describe("orphan card deletion on SQLite", () => {
  it("delete_node removes the subtree cards that have no remaining nodes", async () => {
    const { card: parent, node_id: parentNodeId } = await cardService.createCard({
      card_type: "structure",
      title: "Parent",
    });
    const { card: first, node_id: firstNodeId } = await cardService.createCard({
      card_type: "knowledge",
      title: "First child",
      parent_node_id: parentNodeId,
    });
    const { card: second, node_id: secondNodeId } = await cardService.createCard({
      card_type: "knowledge",
      title: "Second child",
      parent_node_id: parentNodeId,
    });

    expect(await treeService.deleteNode(parentNodeId)).toBe(true);

    expect(await cardService.getCard(parent.id)).toBeNull();
    expect(await cardService.getCard(first.id)).toBeNull();
    expect(await cardService.getCard(second.id)).toBeNull();
    expect(await treeService.getNode(firstNodeId)).toBeNull();
    expect(await treeService.getNode(secondNodeId)).toBeNull();
  });

  it("keeps a descendant card and symlink when the canonical node is deleted", async () => {
    const { node_id: parentNodeId } = await cardService.createCard({
      card_type: "structure",
      title: "Parent",
    });
    const { card: child, node_id: childNodeId } = await cardService.createCard({
      card_type: "knowledge",
      title: "Child",
      parent_node_id: parentNodeId,
    });
    const { node_id: otherRootId } = await cardService.createCard({
      card_type: "structure",
      title: "Other root",
    });
    const alias = await treeService.createSymlink(child.id, otherRootId);

    await treeService.deleteNode(parentNodeId);

    expect(await treeService.getNode(childNodeId)).toBeNull();
    expect(await cardService.getCard(child.id)).not.toBeNull();
    expect(await treeService.getNode(alias.id)).not.toBeNull();
  });

  it("delete_card removes orphaned descendants of its canonical node", async () => {
    const { card: parent, node_id: parentNodeId } = await cardService.createCard({
      card_type: "structure",
      title: "Parent",
    });
    const { card: child } = await cardService.createCard({
      card_type: "knowledge",
      title: "Child",
      parent_node_id: parentNodeId,
    });

    expect(await cardService.deleteCard(parent.id)).toBe(true);
    expect(await cardService.getCard(child.id)).toBeNull();
  });

  it("batch deletes remove orphaned descendants of the deleted card", async () => {
    const { card: parent, node_id: parentNodeId } = await cardService.createCard({
      card_type: "structure",
      title: "Parent",
    });
    const { card: child } = await cardService.createCard({
      card_type: "knowledge",
      title: "Child",
      parent_node_id: parentNodeId,
    });

    await executeBatchOp({ deletes: [{ card_id: parent.id }] });
    expect(await cardService.getCard(child.id)).toBeNull();
  });
});
