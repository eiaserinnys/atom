/**
 * Tree outline — SQLite dialect contract.
 *
 * The outline query is a single recursive CTE written in the Postgres dialect
 * and translated by SqliteAdapter; this suite proves the same tree yields the
 * same outline on SQLite.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import { closeDb, runMigrations, setDb } from "../../src/db/client.js";
import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import * as treeService from "../../src/services/tree.service.js";
import {
  expectedUnderR,
  expectNoBodies,
  seedOutlineFixture,
  shapeOf,
  type OutlineFixture,
} from "./tree-outline-fixtures.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations-sqlite");

let dbPath: string;
let fx: OutlineFixture;

beforeEach(async () => {
  dbPath = path.join(os.tmpdir(), `atom-outline-${crypto.randomUUID()}.db`);
  setDb(new SqliteAdapter(dbPath));
  await runMigrations(MIGRATIONS_DIR);
  fx = await seedOutlineFixture();
});

afterEach(async () => {
  await closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
});

describe("tree outline on SQLite", () => {
  it.each([1, 2, 3] as const)("depth=%i matches the Postgres contract", async (depth) => {
    const outline = await treeService.getTreeOutline(fx.R, depth);
    expect(outline).not.toBeNull();
    expect(outline!.canonical_node_id).toBe(fx.R);
    expect(shapeOf(outline!.nodes)).toEqual(expectedUnderR(depth));
    expect(outline!.nodes.map((n) => typeof n.position)).toEqual(["number", "number", "number"]);
    expect(outline!.nodes[2]!.is_symlink).toBe(true);
    expectNoBodies(outline!);
  });

  it("lists the virtual root", async () => {
    const outline = await treeService.getTreeOutline(null, 1);
    expect(shapeOf(outline!.nodes).map((n) => [n.title, n.child_count, n.descendant_count])).toEqual([
      ["R", 3, 7],
      ["X", 2, 2],
    ]);
  });

  it("resolves a symlink node_id to the canonical node", async () => {
    const outline = await treeService.getTreeOutline(fx.S, 2);
    expect(outline!.node_id).toBe(fx.S);
    expect(outline!.canonical_node_id).toBe(fx.X);
    expect(outline!.nodes.map((n) => n.id)).toEqual([fx.X1, fx.X2]);
  });

  it("returns null for an unknown node", async () => {
    expect(await treeService.getTreeOutline("6f1f7c2e-8a3b-4c5d-9e0f-112233445566", 2)).toBeNull();
  });
});
