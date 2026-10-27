import Fastify from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, getDb, runMigrations, setDb } from "../../src/db/client.js";
import { PostgresAdapter } from "../../src/db/adapters/postgres.js";
import { insertCard } from "../../src/db/queries/cards.js";
import { insertNode } from "../../src/db/queries/tree.js";
import { createSearchHandler } from "../../src/api/routes/search.js";
import { getNode, getTreeOutline } from "../../src/services/tree.service.js";
import { searchCards } from "../../src/services/search.service.js";
import { searchWithJev } from "../../src/services/jev-search/service.js";
import { JEV_SEARCH_POLICY } from "../../src/services/jev-search/config.js";
import type { JevMeaningPayload, JevSearchInput, JevSearchResponse } from "../../src/shared/jev-search.js";
import type { SearchResult } from "../../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrations = path.join(root, "src/db/migrations");
let databaseWasEmpty = false;

function createJevRunner(payloads: JevMeaningPayload[], roots: Array<string | null>) {
  return async (input: JevSearchInput, signal?: AbortSignal): Promise<JevSearchResponse> => {
    roots.push(input.root_node_id ?? null);
    return searchWithJev(input, {
      getNode,
      getTreeOutline,
      searchCards,
      judge: async payload => {
        payloads.push(payload);
        return {
          model: "jev-latest",
          usage: { input_tokens: 1, output_tokens: 1 },
          answers: Object.fromEntries(Object.keys(payload.questions).map(key => [key, {
            type: "noul",
            noul: 0.9,
          }])),
        };
      },
      policy: { ...JEV_SEARCH_POLICY },
    }, signal);
  };
}

async function requestJev(rootNodeId: string, query: string, runner: ReturnType<typeof createJevRunner>) {
  const app = Fastify({ logger: false });
  app.get("/search", createSearchHandler({ runJev: runner }));
  try {
    return await app.inject({
      method: "GET",
      url: `/search?${new URLSearchParams({ q: query, engine: "jev", root_node_id: rootNodeId, exhaustive: "1" })}`,
    });
  } finally {
    await app.close();
  }
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
  if (count !== 0) throw new Error("PostgreSQL search regression requires an empty test database.");
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

describe("U6 PostgreSQL scoped alias search", () => {
  it("returns the in-scope alias occurrence and keeps Jev away from its canonical parent", async () => {
    const db = getDb();
    const outsideParent = await insertCard(db, { card_type: "structure", title: "Outside parent Q", content: null });
    const outsideParentNode = await insertNode(db, outsideParent.id, null, 1);
    const aliasedCard = await insertCard(db, { card_type: "knowledge", title: "Aliased target X", content: "u6pgscopealiasneedle" });
    const canonicalNode = await insertNode(db, aliasedCard.id, outsideParentNode.id, 1);
    const outsideSibling = await insertCard(db, { card_type: "knowledge", title: "Outside sibling Y", content: "u6pgscopealiasneedle" });
    const outsideSiblingNode = await insertNode(db, outsideSibling.id, outsideParentNode.id, 2);
    const scope = await insertCard(db, { card_type: "structure", title: "Requested scope R", content: null });
    const scopeNode = await insertNode(db, scope.id, null, 2);
    const aliasNode = await insertNode(db, aliasedCard.id, scopeNode.id, 1, true);
    const query = "u6pgscopealiasneedle";

    const bm25 = await searchCards({ query, strategy: "strict", root_node_id: scopeNode.id });
    const payloads: JevMeaningPayload[] = [];
    const roots: Array<string | null> = [];
    const response = await requestJev(scopeNode.id, query, createJevRunner(payloads, roots));
    const jev = response.json() as JevSearchResponse;
    const allPayloads = JSON.stringify(payloads);

    expect({
      bm25CardIds: bm25.map(result => result.card_id),
      bm25NodeId: bm25[0]?.node_id,
      bm25IsSymlink: bm25[0]?.is_symlink,
      jevStatus: response.statusCode,
      jevRoots: roots,
      jevHasTarget: jev.results.some(result => result.card_id === aliasedCard.id),
      jevHasOutsideSibling: jev.results.some(result => result.card_id === outsideSibling.id),
      payloadHasOutsideParent: allPayloads.includes(outsideParent.title),
      payloadHasOutsideSibling: allPayloads.includes(outsideSibling.title),
    }).toEqual({
      bm25CardIds: [aliasedCard.id],
      bm25NodeId: aliasNode.id,
      bm25IsSymlink: true,
      jevStatus: 200,
      jevRoots: [scopeNode.id],
      jevHasTarget: true,
      jevHasOutsideSibling: false,
      payloadHasOutsideParent: false,
      payloadHasOutsideSibling: false,
    });

    expect(canonicalNode.id).not.toBe(aliasNode.id);
    expect(outsideSiblingNode.id).not.toBe(aliasNode.id);
  });

  it("uses the canonical subtree when the requested root is an alias", async () => {
    const db = getDb();
    const outsideParent = await insertCard(db, { card_type: "structure", title: "Alias-root parent Q", content: null });
    const outsideParentNode = await insertNode(db, outsideParent.id, null, 1);
    const canonicalRoot = await insertCard(db, { card_type: "structure", title: "Alias-root canonical P", content: null });
    const canonicalRootNode = await insertNode(db, canonicalRoot.id, outsideParentNode.id, 1);
    const target = await insertCard(db, { card_type: "knowledge", title: "Alias-root target", content: "u6pgrootaliasneedle" });
    const targetNode = await insertNode(db, target.id, canonicalRootNode.id, 1);
    const outsideSibling = await insertCard(db, { card_type: "knowledge", title: "Alias-root sibling Y", content: "u6pgrootaliasneedle" });
    await insertNode(db, outsideSibling.id, outsideParentNode.id, 2);
    const aliasRoot = await insertNode(db, canonicalRoot.id, null, 2, true);
    const query = "u6pgrootaliasneedle";

    const bm25 = await searchCards({ query, strategy: "strict", root_node_id: aliasRoot.id });
    const payloads: JevMeaningPayload[] = [];
    const roots: Array<string | null> = [];
    const response = await requestJev(aliasRoot.id, query, createJevRunner(payloads, roots));
    const jev = response.json() as JevSearchResponse;
    const allPayloads = JSON.stringify(payloads);

    expect(bm25.map(result => result.card_id)).toEqual([target.id]);
    expect(bm25[0]?.node_id).toBe(targetNode.id);
    expect(JSON.stringify(bm25)).not.toContain(outsideParent.title);
    expect(JSON.stringify(bm25)).not.toContain(outsideSibling.title);
    expect(response.statusCode).toBe(200);
    expect(roots).toEqual([canonicalRootNode.id]);
    expect(jev.results.map(result => result.card_id)).toContain(target.id);
    expect(jev.results.map(result => result.card_id)).not.toContain(outsideSibling.id);
    expect(JSON.stringify(jev.results)).not.toContain(outsideParent.title);
    expect(JSON.stringify(jev.results)).not.toContain(outsideSibling.title);
    expect(allPayloads).toContain(target.title);
    expect(allPayloads).not.toContain(outsideParent.title);
    expect(allPayloads).not.toContain(outsideSibling.title);
  });
});
