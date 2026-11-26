import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, getDb, runMigrations, setDb } from "../../src/db/client.js";
import { PostgresAdapter } from "../../src/db/adapters/postgres.js";
import { insertCard } from "../../src/db/queries/cards.js";
import { insertNode } from "../../src/db/queries/tree.js";
import { searchByBm25 } from "../../src/db/queries/search.js";
import { searchCards } from "../../src/services/search.service.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrations = path.join(root, "src/db/migrations");
let databaseWasEmpty = false;

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

beforeAll(async () => {
  const databaseUrl = process.env["TEST_DATABASE_URL"];
  if (!databaseUrl || !databaseUrl.includes("test")) {
    throw new Error("TEST_DATABASE_URL must point to an empty PostgreSQL test database.");
  }
  if (/atom_db|reverie|soulstream|serendipity/i.test(databaseUrl)) {
    throw new Error("TEST_DATABASE_URL must not name a production database.");
  }

  setDb(new PostgresAdapter(databaseUrl));
  await runMigrations(migrations);
  const count = Number((await getDb().query("SELECT COUNT(*) AS n FROM cards")).rows[0]?.n ?? -1);
  if (count !== 0) throw new Error("PostgreSQL prefix search test requires an empty test database.");
  databaseWasEmpty = true;
}, 30000);

afterEach(async () => {
  if (!databaseWasEmpty) return;
  await getDb().query("DELETE FROM tree_nodes");
  await getDb().query("DELETE FROM cards");
});

afterAll(async () => {
  await closeDb();
}, 10000);

describe("PostgreSQL search prefix matching", () => {
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
    expect((await titlesFor('"deploy guide"')).sort()).toEqual(["alpha", "beta"]);
    expect(await titlesFor('"guide deploy"')).toEqual([]);
    expect(await titlesFor("deploy -소울스트림")).toEqual(["alpha"]);
    expect(await titlesFor("deploy -소울스트림에서")).toEqual(["beta"]);
    expect((await titlesFor("소울스트림 OR haniel")).sort()).toEqual(["alpha", "beta", "gamma"]);
    expect((await titlesFor("소울스트림 or haniel")).sort()).toEqual(["alpha", "beta", "gamma"]);
  });

  it("ignores a dangling OR like websearch_to_tsquery does", async () => {
    await addCard("alpha", "소울스트림에서 deploy guide");

    expect(await titlesFor("소울스트림 OR")).toEqual(["alpha"]);
    expect(await titlesFor("OR 소울스트림")).toEqual(["alpha"]);
  });

  it("accepts quotes and backslashes inside words without a syntax error", async () => {
    await addCard("weird", "it's a back\\slash 'quote' foo-bar");

    expect(await titlesFor("it's")).toEqual(["weird"]);
    expect(await titlesFor("back\\slash")).toEqual(["weird"]);
    expect(await titlesFor("foo-bar")).toEqual(["weird"]);
    expect(await titlesFor("!!!")).toEqual([]);
  });

  it("ranks whole-word matches before prefix-only matches", async () => {
    await addCard("prefix only", "quokkamarker quokkamarker quokkamarker");
    await addCard("whole word", "quokka");

    expect(await titlesFor("quokka")).toEqual(["whole word", "prefix only"]);
  });

  it("ranks whole-word matches first inside a scoped search too", async () => {
    const top = await addCard("Scope", "container");
    await addCard("prefix only", "quokkamarker quokkamarker quokkamarker", top.node.id, 1);
    await addCard("whole word", "quokka", top.node.id, 2);

    expect(await titlesFor("quokka", { root_node_id: top.node.id })).toEqual(["whole word", "prefix only"]);
  });
});

describe("PostgreSQL search fallback disclosure", () => {
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

  it("marks results found by the synonym retry and stays silent with strategy strict", async () => {
    await addCard("shortcut", "canonical target");

    const widened = await searchCards({ query: "심링크" });
    const strict = await searchCards({ query: "심링크", strategy: "strict" });

    expect(widened.map(result => result.title)).toEqual(["shortcut"]);
    expect(widened[0]?.fallback?.kind).toBe("synonym");
    expect(strict).toEqual([]);
  });
});
