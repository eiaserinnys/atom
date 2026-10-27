import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jest } from "@jest/globals";

import { closeDb, getDb, runMigrations, setDb } from "../../src/db/client.js";
import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import { updateCardById, selectCardById } from "../../src/db/queries/cards.js";
import type { CompileOptions } from "../../src/shared/bfs.js";
import { posToKey } from "../../src/shared/lexorank.js";
import type { UnfurlAdapter, UnfurlResult } from "../../src/unfurl/interface.js";
import { adapterRegistry } from "../../src/unfurl/registry.js";
import * as treeService from "../../src/services/tree.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations-sqlite");
const SOURCE_TYPE = "card725-u7-test";
const SOURCE_PREFIX = "u7://";

let dbPath: string;
let positions: Map<string, number>;
let adapterCalls: string[];
let resolveReference: (ref: string) => Promise<UnfurlResult>;

function resultFor(ref: string): UnfurlResult {
  const text = `resolved: ${ref}`;
  const unfurlData = { ref };
  return {
    text,
    unfurlData,
    snapshot: JSON.stringify({ text, unfurlData }),
  };
}

const fakeAdapter: UnfurlAdapter = {
  sourceType: SOURCE_TYPE,
  credentialFields: [],
  canHandle: (ref) => ref.startsWith(SOURCE_PREFIX),
  resolve: (ref) => {
    adapterCalls.push(ref);
    return resolveReference(ref);
  },
};

beforeEach(async () => {
  dbPath = path.join(os.tmpdir(), `atom-card725-u7-${crypto.randomUUID()}.db`);
  setDb(new SqliteAdapter(dbPath));
  await runMigrations(MIGRATIONS_DIR);
  positions = new Map();
  adapterCalls = [];
  resolveReference = async (ref) => resultFor(ref);
  adapterRegistry.register(fakeAdapter);
});

afterEach(async () => {
  await closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
});

interface SeedCardOptions {
  title: string;
  parentNodeId?: string | null;
  sourceRef?: string | null;
  sourceType?: string | null;
  sourceSnapshot?: string | null;
  cardTimestamp?: string;
  journalLimit?: number | null;
}

async function seedNode(
  cardId: string,
  parentNodeId: string | null,
  isSymlink: boolean = false,
  journalLimit: number | null = null
): Promise<string> {
  const nodeId = crypto.randomUUID();
  const key = parentNodeId ?? "<root>";
  const position = (positions.get(key) ?? 0) + 100;
  positions.set(key, position);
  await getDb().query(
    `INSERT INTO tree_nodes (id, card_id, parent_node_id, position, is_symlink, journal_limit)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [nodeId, cardId, parentNodeId, posToKey(position), isSymlink, journalLimit]
  );
  return nodeId;
}

async function seedCard(options: SeedCardOptions): Promise<{ cardId: string; nodeId: string }> {
  const cardId = crypto.randomUUID();
  const sourceRef = options.sourceRef ?? null;
  const sourceType = options.sourceType === undefined
    ? (sourceRef ? SOURCE_TYPE : null)
    : options.sourceType;
  await getDb().query(
    `INSERT INTO cards (id, card_type, title, content, tags, "references", source_type, source_ref, source_snapshot, card_timestamp)
     VALUES ($1, 'knowledge', $2, $3, '[]', '[]', $4, $5, $6, $7)`,
    [
      cardId,
      options.title,
      `body: ${options.title}`,
      sourceType,
      sourceRef,
      options.sourceSnapshot ?? null,
      options.cardTimestamp ?? "2026-01-01T00:00:00.000Z",
    ]
  );
  const nodeId = await seedNode(
    cardId,
    options.parentNodeId ?? null,
    false,
    options.journalLimit ?? null
  );
  return { cardId, nodeId };
}

async function expectUnresolved(
  rootNodeId: string,
  depth: number,
  cardId: string,
  options: CompileOptions = {}
): Promise<void> {
  const result = await treeService.compileSubtree(
    rootNodeId,
    depth,
    options,
    "fresh",
    {},
    true
  );
  expect(adapterCalls).toEqual([]);
  expect(result.unfurls).toBeUndefined();
  expect((await selectCardById(getDb(), cardId))?.source_snapshot).toBeNull();
}

describe("U7 compile reference scope on SQLite", () => {
  it("does not resolve an external reference on an excluded root", async () => {
    const external = await seedCard({ title: "Excluded root", sourceRef: "u7://excluded-root" });

    await expectUnresolved(external.nodeId, 0, external.cardId, {
      excludeNodes: new Set([external.nodeId]),
    });
  });

  it("does not resolve an external reference below an excluded node", async () => {
    const root = await seedCard({ title: "Root" });
    const omittedBranch = await seedCard({ title: "Omitted branch", parentNodeId: root.nodeId });
    const external = await seedCard({
      title: "Excluded descendant",
      parentNodeId: omittedBranch.nodeId,
      sourceRef: "u7://excluded-descendant",
    });

    await expectUnresolved(root.nodeId, 2, external.cardId, {
      excludeNodes: new Set([omittedBranch.nodeId]),
    });
  });

  it("does not resolve an external reference clipped by limit", async () => {
    const root = await seedCard({ title: "Root" });
    const external = await seedCard({
      title: "Older external child",
      parentNodeId: root.nodeId,
      sourceRef: "u7://limited-child",
      cardTimestamp: "2026-01-01T00:00:00.000Z",
    });
    await seedCard({
      title: "Newest child",
      parentNodeId: root.nodeId,
      cardTimestamp: "2026-01-02T00:00:00.000Z",
    });

    await expectUnresolved(root.nodeId, 1, external.cardId, { limit: 1 });
  });

  it("does not resolve an external reference clipped by journal_limit", async () => {
    const root = await seedCard({ title: "Root" });
    const journal = await seedCard({
      title: "Journal",
      parentNodeId: root.nodeId,
      journalLimit: 1,
    });
    const external = await seedCard({
      title: "Older journal child",
      parentNodeId: journal.nodeId,
      sourceRef: "u7://journal-limited-child",
    });
    await seedCard({ title: "Newest journal child", parentNodeId: journal.nodeId });

    await expectUnresolved(root.nodeId, 2, external.cardId);
  });

  it("does not resolve references in titles-only output", async () => {
    const external = await seedCard({ title: "Titles only", sourceRef: "u7://titles-only" });

    await expectUnresolved(external.nodeId, 0, external.cardId, { titlesOnly: true });
  });

  it("resolves and displays an external reference when its card is emitted", async () => {
    const root = await seedCard({ title: "Root" });
    const external = await seedCard({
      title: "Included external child",
      parentNodeId: root.nodeId,
      sourceRef: "u7://included",
    });

    const result = await treeService.compileSubtree(root.nodeId, 1, {}, "fresh", {}, false);

    expect(adapterCalls).toEqual(["u7://included"]);
    expect(result.markdown).toContain("resolved: u7://included");
    expect(result.unfurls?.[external.cardId]).toEqual({
      ok: true,
      data: { ref: "u7://included" },
      sourceType: SOURCE_TYPE,
    });
    expect((await selectCardById(getDb(), external.cardId))?.source_snapshot).toBeNull();
  });

  it("resolves an external card once when a symlink emits it twice", async () => {
    const root = await seedCard({ title: "Root" });
    const canonical = await seedCard({ title: "Canonical", parentNodeId: root.nodeId });
    const external = await seedCard({
      title: "Aliased external child",
      parentNodeId: canonical.nodeId,
      sourceRef: "u7://aliased",
    });
    await seedNode(canonical.cardId, root.nodeId, true);

    const result = await treeService.compileSubtree(root.nodeId, 2, {}, "fresh", {}, false);

    expect(adapterCalls).toEqual(["u7://aliased"]);
    expect(result.markdown.match(/resolved: u7:\/\/aliased/g)).toHaveLength(2);
    expect(result.unfurls?.[external.cardId]?.ok).toBe(true);
  });
});

describe("U7 source-bound snapshots on SQLite", () => {
  it("clears snapshots when a source changes and cached compile resolves the new source", async () => {
    const external = await seedCard({ title: "Changing source", sourceRef: "u7://ref1" });
    const db = getDb();
    const queries = jest.spyOn(db, "query");

    try {
      await treeService.compileSubtree(external.nodeId, 0, {}, "fresh", {}, true);
      await Promise.all(queries.mock.results.filter((result) => result.type === "return").map((result) => result.value));
      expect((await selectCardById(db, external.cardId))?.source_snapshot).toBe(resultFor("u7://ref1").snapshot);

      const changed = await updateCardById(db, external.cardId, { source_ref: "u7://ref2" }, false);
      expect(changed).toMatchObject({ conflict: false, card: { source_snapshot: null } });

      const result = await treeService.compileSubtree(external.nodeId, 0, {}, "cached", {}, true);
      await Promise.all(queries.mock.results.filter((entry) => entry.type === "return").map((entry) => entry.value));
      expect(adapterCalls).toEqual(["u7://ref1", "u7://ref2"]);
      expect(result.markdown).toContain("resolved: u7://ref2");
      expect((await selectCardById(db, external.cardId))?.source_snapshot).toBe(resultFor("u7://ref2").snapshot);

      const snapshot = (await selectCardById(db, external.cardId))?.source_snapshot;
      await updateCardById(db, external.cardId, {
        content: "Edited card body",
        content_timestamp: "2026-10-28T00:00:00.000Z",
      }, true);
      expect((await selectCardById(db, external.cardId))?.source_snapshot).toBe(snapshot);
    } finally {
      queries.mockRestore();
    }
  });

  it("does not store a delayed result after the card source changes", async () => {
    const external = await seedCard({ title: "Delayed source", sourceRef: "u7://slow-ref1" });
    let markStarted!: () => void;
    let finishResolve!: (result: UnfurlResult) => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const delayedResult = new Promise<UnfurlResult>((resolve) => { finishResolve = resolve; });
    resolveReference = async () => {
      markStarted();
      return delayedResult;
    };

    const db = getDb();
    const queries = jest.spyOn(db, "query");
    try {
      const pendingCompile = treeService.compileSubtree(external.nodeId, 0, {}, "fresh", {}, true);
      await started;
      await updateCardById(db, external.cardId, { source_ref: "u7://slow-ref2" }, false);
      finishResolve(resultFor("u7://slow-ref1"));
      await pendingCompile;
      await Promise.all(queries.mock.results.filter((result) => result.type === "return").map((result) => result.value));

      expect((await selectCardById(db, external.cardId))?.source_snapshot).toBeNull();
      const writeIndex = queries.mock.calls.findIndex(([sql]) =>
        sql.includes("SET source_snapshot = $1") &&
        sql.includes("source_ref IS NOT DISTINCT FROM")
      );
      expect(writeIndex).toBeGreaterThanOrEqual(0);
      const writeResult = await (queries.mock.results[writeIndex]!.value as Promise<{ rowCount: number | null }>);
      expect(writeResult.rowCount).toBe(0);
    } finally {
      queries.mockRestore();
    }
  });

  it("clears snapshots for source_type changes but retains an explicitly supplied snapshot", async () => {
    const external = await seedCard({
      title: "Source type change",
      sourceRef: "u7://source-type",
      sourceSnapshot: "old snapshot",
    });
    const db = getDb();

    const changed = await updateCardById(db, external.cardId, { source_type: "different-source" }, false);
    expect(changed).toMatchObject({ conflict: false, card: { source_snapshot: null } });

    const explicit = await updateCardById(db, external.cardId, {
      source_ref: "u7://explicit-ref",
      source_snapshot: "explicit snapshot",
    }, false);
    expect(explicit).toMatchObject({ conflict: false, card: { source_snapshot: "explicit snapshot" } });
  });

  it("stores a cached fallback resolve across source_type repair and reuses it", async () => {
    const external = await seedCard({
      title: "Fallback source type",
      sourceType: "web",
      sourceRef: "u7://fallback",
    });
    const db = getDb();
    const queries = jest.spyOn(db, "query");

    try {
      await treeService.compileSubtree(external.nodeId, 0, {}, "cached", {}, true);
      await Promise.all(queries.mock.results.filter((result) => result.type === "return").map((result) => result.value));

      expect(adapterCalls).toEqual(["u7://fallback"]);
      expect(await selectCardById(db, external.cardId)).toMatchObject({
        source_type: SOURCE_TYPE,
        source_snapshot: resultFor("u7://fallback").snapshot,
      });

      const result = await treeService.compileSubtree(external.nodeId, 0, {}, "cached", {}, true);
      expect(adapterCalls).toEqual(["u7://fallback"]);
      expect(result.markdown).toContain("resolved: u7://fallback");
    } finally {
      queries.mockRestore();
    }
  });
});
