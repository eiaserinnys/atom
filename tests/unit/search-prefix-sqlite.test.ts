import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, getDb, runMigrations, setDb } from "../../src/db/client.js";
import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import { insertCard } from "../../src/db/queries/cards.js";
import { searchByBm25 } from "../../src/db/queries/search.js";
import { insertNode } from "../../src/db/queries/tree.js";
import { searchCards } from "../../src/services/search.service.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrations = path.join(root, "src/db/migrations-sqlite");

async function addCard(title: string, content: string, parentNodeId: string | null = null, position = 1) {
  const db = getDb();
  const card = await insertCard(db, { card_type: "knowledge", title, content });
  const node = await insertNode(db, card.id, parentNodeId, position);
  return { card, node };
}

async function titlesFor(query: string, extra: Record<string, unknown> = {}) {
  const results = await searchByBm25(getDb(), { query, ...extra });
  return results.map(result => result.title);
}

describe("SQLite search prefix matching", () => {
  beforeEach(async () => {
    setDb(new SqliteAdapter(":memory:"));
    await runMigrations(migrations);
  });

  afterEach(async () => {
    await closeDb();
  });

  it("matches a Korean word followed by a particle", async () => {
    await addCard("배포 메모", "소울스트림에서 에이전트가 돈다");
    await addCard("무관", "다른 이야기");

    expect(await titlesFor("소울스트림")).toEqual(["배포 메모"]);
    expect(await titlesFor("에이전트")).toEqual(["배포 메모"]);
  });

  it("matches the start of an English word", async () => {
    await addCard("marker", "this has quokkamarker inside");

    expect(await titlesFor("quokka")).toEqual(["marker"]);
  });

  it("does not match a fragment from the middle of a word", async () => {
    await addCard("배포 메모", "소울스트림에서 돈다 quokkamarker");

    expect(await titlesFor("스트림")).toEqual([]);
    expect(await titlesFor("marker")).toEqual([]);
  });

  it("keeps quoted phrases, exclusions and OR as whole-word matches", async () => {
    await addCard("alpha", "소울스트림에서 deploy guide");
    await addCard("beta", "소울스트림 deploy guide");
    await addCard("gamma", "haniel notes");

    expect(await titlesFor('"소울스트림"')).toEqual(["beta"]);
    expect(await titlesFor('"deploy guide"')).toEqual(expect.arrayContaining(["alpha", "beta"]));
    expect(await titlesFor("deploy -소울스트림")).toEqual(["alpha"]);
    expect((await titlesFor("-소울스트림 OR haniel")).sort()).toEqual(["gamma"]);
    expect((await titlesFor("소울스트림 OR haniel")).sort()).toEqual(["alpha", "beta", "gamma"]);
  });

  it("ranks whole-word matches before prefix-only matches", async () => {
    await addCard("prefix only", "quokkamarker quokkamarker quokkamarker");
    await addCard("whole word", "quokka");

    expect(await titlesFor("quokka")).toEqual(["whole word", "prefix only"]);
  });

  it("keeps the old order among whole-word matches even when a prefix form repeats", async () => {
    await addCard("prefix heavy", `소울스트림 ${"소울스트림에서 ".repeat(10)}`);
    await addCard("whole heavy", "소울스트림 소울스트림 소울스트림");
    await addCard("prefix only", "소울스트림에서 소울스트림은");

    expect(await titlesFor("소울스트림")).toEqual(["whole heavy", "prefix heavy", "prefix only"]);
  });

  it("keeps that order inside a scoped search", async () => {
    const top = await addCard("Scope", "container");
    await addCard("prefix heavy", `소울스트림 ${"소울스트림에서 ".repeat(10)}`, top.node.id, 1);
    await addCard("whole heavy", "소울스트림 소울스트림 소울스트림", top.node.id, 2);

    expect(await titlesFor("소울스트림", { root_node_id: top.node.id })).toEqual(["whole heavy", "prefix heavy"]);
  });

  it("applies prefix matching to every plain word", async () => {
    await addCard("both", "소울스트림에서 배포를 한다");
    await addCard("one", "소울스트림에서 쉰다");

    expect(await titlesFor("소울스트림 배포")).toEqual(["both"]);
  });
});

describe("SQLite search node_path", () => {
  beforeEach(async () => {
    setDb(new SqliteAdapter(":memory:"));
    await runMigrations(migrations);
  });

  afterEach(async () => {
    await closeDb();
  });

  it("returns ancestor titles from the root to the parent", async () => {
    const top = await addCard("Top", "container");
    const middle = await addCard("Middle", "container", top.node.id);
    const leaf = await addCard("Leaf", "needlepath here", middle.node.id);

    const [result] = await searchByBm25(getDb(), { query: "needlepath" });

    expect(result?.card_id).toBe(leaf.card.id);
    expect(result?.node_path).toEqual(["Top", "Middle"]);
  });

  it("returns an empty path for a root card", async () => {
    await addCard("Solo", "needlesolo here");

    const [result] = await searchByBm25(getDb(), { query: "needlesolo" });

    expect(result?.node_path).toEqual([]);
  });

  it("keeps the full ancestor path under a scoped search before trimming", async () => {
    const top = await addCard("Top", "container");
    const middle = await addCard("Middle", "container", top.node.id);
    await addCard("Leaf", "needlescope here", middle.node.id);

    const [result] = await searchByBm25(getDb(), { query: "needlescope", root_node_id: middle.node.id });

    expect(result?.node_path).toEqual(["Top", "Middle"]);
  });
});

describe("search fallback disclosure", () => {
  beforeEach(async () => {
    setDb(new SqliteAdapter(":memory:"));
    await runMigrations(migrations);
  });

  afterEach(async () => {
    await closeDb();
  });

  it("does not mark results that matched the original query", async () => {
    await addCard("direct", "소울스트림에서 배포한다");

    const results = await searchCards({ query: "소울스트림" });

    expect(results).toHaveLength(1);
    expect(results[0]).not.toHaveProperty("fallback");
  });

  it("marks results found by the relaxed OR retry with the query actually used", async () => {
    await addCard("partial", "alphaone only");

    const results = await searchCards({ query: "alphaone betatwo gammathree deltafour" });

    expect(results.map(result => result.title)).toEqual(["partial"]);
    expect(results[0]?.fallback).toEqual({
      kind: "relaxed_or",
      query: "alphaone OR betatwo OR gammathree OR deltafour",
    });
  });

  it("marks results found by the synonym retry", async () => {
    await addCard("shortcut", "canonical target");

    const results = await searchCards({ query: "심링크" });

    expect(results.map(result => result.title)).toEqual(["shortcut"]);
    expect(results[0]?.fallback?.kind).toBe("synonym");
    expect(results[0]?.fallback?.query).toContain("심링크 OR symlink");
  });

  it("does not widen or mark anything with strategy strict", async () => {
    await addCard("shortcut", "canonical target");

    const results = await searchCards({ query: "심링크", strategy: "strict" });

    expect(results).toEqual([]);
  });
});
