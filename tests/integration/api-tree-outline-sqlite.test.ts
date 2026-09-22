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
    const outline = await treeService.getTreeOutline(fx.R, depth, 0);
    expect(outline).not.toBeNull();
    expect(outline!.canonical_node_id).toBe(fx.R);
    expect(shapeOf(outline!.nodes)).toEqual(expectedUnderR(depth));
    expect(outline!.nodes.map((n) => typeof n.position)).toEqual(["number", "number", "number"]);
    expect(outline!.nodes[2]!.is_symlink).toBe(true);
    expectNoBodies(outline!);
  });

  it("lists the virtual root", async () => {
    const outline = await treeService.getTreeOutline(null, 1, 0);
    expect(shapeOf(outline!.nodes).map((n) => [n.title, n.child_count, n.descendant_count])).toEqual([
      ["R", 3, 7],
      ["X", 2, 2],
    ]);
  });

  it("resolves a symlink node_id to the canonical node", async () => {
    const outline = await treeService.getTreeOutline(fx.S, 2, 0);
    expect(outline!.node_id).toBe(fx.S);
    expect(outline!.canonical_node_id).toBe(fx.X);
    expect(outline!.nodes.map((n) => n.id)).toEqual([fx.X1, fx.X2]);
  });

  it("returns null for an unknown node", async () => {
    expect(await treeService.getTreeOutline("6f1f7c2e-8a3b-4c5d-9e0f-112233445566", 2, 0)).toBeNull();
  });
});

describe("tree outline excerpts on SQLite", () => {
  it("adds a plain-text excerpt to every node, depth-2 children included", async () => {
    const outline = await treeService.getTreeOutline(fx.R, 2, 200);
    expect(excerptsOf(outline!.nodes)).toEqual(EXPECTED_EXCERPTS_UNDER_R_DEPTH_2);
    // Structure is unchanged by the excerpt.
    expect(shapeOf(outline!.nodes)).toEqual(expectedUnderR(2));
  });

  it("cuts a long body and never ships it whole", async () => {
    const long = await seedCard("Long", fx.B, "knowledge", LONG_BODY);
    const outline = await treeService.getTreeOutline(fx.B, 1, 400);
    const node = outline!.nodes.find((n) => n.id === long.nodeId)!;
    expect(node.excerpt).toBe(`Long card ${"word ".repeat(78).trimEnd()}…`);
    const serialized = JSON.stringify(outline);
    expect(serialized).not.toContain("TAIL-MARKER");
    expect(serialized).not.toContain("hidden");
  });

  it("returns a null excerpt for a card without content", async () => {
    const empty = await seedCard("Empty", fx.B, "knowledge", null);
    const outline = await treeService.getTreeOutline(fx.B, 1, 200);
    expect(outline!.nodes.find((n) => n.id === empty.nodeId)!.excerpt).toBeNull();
  });
});
