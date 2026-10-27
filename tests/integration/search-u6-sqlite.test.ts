import Fastify from "fastify";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, getDb, runMigrations, setDb } from "../../src/db/client.js";
import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import { insertCard } from "../../src/db/queries/cards.js";
import { insertNode } from "../../src/db/queries/tree.js";
import { createSearchHandler } from "../../src/api/routes/search.js";
import { getNode, getTreeOutline } from "../../src/services/tree.service.js";
import { searchCards } from "../../src/services/search.service.js";
import { searchWithJev } from "../../src/services/jev-search/service.js";
import { JEV_SEARCH_POLICY } from "../../src/services/jev-search/config.js";
import { registerSearchTools } from "../../src/mcp/tools/search_tools.js";
import type { JevMeaningPayload } from "../../src/shared/jev-search.js";
import type { SearchResult } from "../../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrations = path.join(root, "src/db/migrations-sqlite");

type ToolHandler = (input: Record<string, unknown>, extra: { signal?: AbortSignal }) => Promise<unknown>;

function captureSearchCardsTool(): ToolHandler {
  let handler: ToolHandler | undefined;
  const server = {
    tool: (name: string, _description: string, _schema: unknown, callback: ToolHandler) => {
      if (name === "search_cards") handler = callback;
    },
  } as unknown as McpServer;
  registerSearchTools(server);
  if (!handler) throw new Error("search_cards was not registered");
  return handler;
}

async function insertSearchCard(title: string, content: string) {
  return insertCard(getDb(), { card_type: "knowledge", title, content });
}

async function runSearchSurfaces(query: string): Promise<{
  direct: SearchResult[];
  httpStatus: number;
  httpResults: SearchResult[];
  mcpResults: SearchResult[];
}> {
  const app = Fastify();
  app.get("/search", createSearchHandler());
  const tool = captureSearchCardsTool();
  try {
    const [direct, http, mcp] = await Promise.all([
      searchCards({ query, strategy: "strict" }),
      app.inject({ method: "GET", url: `/search?${new URLSearchParams({ q: query, strategy: "strict" })}` }),
      tool({ query, strategy: "strict" }, {}),
    ]);
    const mcpContent = (mcp as { content: Array<{ text: string }> }).content;
    return {
      direct,
      httpStatus: http.statusCode,
      httpResults: http.json() as SearchResult[],
      mcpResults: JSON.parse(mcpContent[0]!.text) as SearchResult[],
    };
  } finally {
    await app.close();
  }
}

beforeEach(async () => {
  setDb(new SqliteAdapter(":memory:"));
  await runMigrations(migrations);
});

afterEach(async () => {
  await closeDb();
});

describe("U6 SQLite search query compatibility", () => {
  const syntaxCases: Array<{ query: string; titles: string[] }> = [
    { query: "foo-bar", titles: ["F1"] },
    { query: "what?", titles: ["F2"] },
    { query: "a -b", titles: ["F5"] },
    { query: '"exact phrase"', titles: ["F3"] },
    { query: "a OR b", titles: ["F5", "F6"] },
    { query: "-only", titles: [] },
    { query: '"unclosed', titles: ["F7"] },
    { query: "c++", titles: ["F8"] },
  ];

  it.each(syntaxCases)("searches $query without FTS errors through SQLite, HTTP, and MCP", async ({ query, titles }) => {
    await insertSearchCard("F1", "foo-bar");
    await insertSearchCard("F2", "what?");
    await insertSearchCard("F3", "exact phrase");
    await insertSearchCard("F4", "exact distant phrase");
    await insertSearchCard("F5", "a");
    await insertSearchCard("F6", "a b");
    await insertSearchCard("F7", "unclosed phrase");
    await insertSearchCard("F8", "c++");

    const result = await runSearchSurfaces(query);
    const expected = [...titles].sort();
    expect(result.direct.map(card => card.title).sort()).toEqual(expected);
    expect(result.httpStatus).toBe(200);
    expect(result.httpResults.map(card => card.title).sort()).toEqual(expected);
    expect(result.mcpResults.map(card => card.title).sort()).toEqual(expected);
  });

  it("turns malformed OR syntax into a controlled HTTP input error", async () => {
    await insertSearchCard("Invalid query fixture", "alpha");
    const app = Fastify();
    app.get("/search", createSearchHandler());
    try {
      const response = await app.inject({ method: "GET", url: "/search?q=alpha%20OR&strategy=strict" });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ statusCode: 400, message: expect.any(String) });
    } finally {
      await app.close();
    }
  });

  it("converts generated OR fallback queries before SQLite FTS5", async () => {
    const card = await insertSearchCard("Fallback fixture", "alpha");
    const results = await searchCards({ query: "alpha beta gamma delta", strategy: "auto" });
    expect(results.map(result => result.card_id)).toEqual([card.id]);
  });
});

describe("U6 SQLite search date filters", () => {
  it("compares UTC storage with ISO timestamps at both boundaries and offsets", async () => {
    const db = getDb();
    const card = await insertSearchCard("D1", "datefilterneedle");
    await db.query("UPDATE cards SET updated_at = $1 WHERE id = $2", ["2024-01-15 12:00:00", card.id]);

    const afterMidnight = await searchCards({ query: "datefilterneedle", strategy: "strict", updated_after: "2024-01-15T00:00:00Z" });
    const afterFraction = await searchCards({ query: "datefilterneedle", strategy: "strict", updated_after: "2024-01-15T12:00:00.500Z" });
    const afterOffsetEqual = await searchCards({ query: "datefilterneedle", strategy: "strict", updated_after: "2024-01-15T21:00:00+09:00" });
    const beforeFractionAfter = await searchCards({ query: "datefilterneedle", strategy: "strict", updated_before: "2024-01-15T12:00:00.500Z" });
    const beforeFractionBefore = await searchCards({ query: "datefilterneedle", strategy: "strict", updated_before: "2024-01-15T11:59:59.999Z" });
    const beforeOffsetEqual = await searchCards({ query: "datefilterneedle", strategy: "strict", updated_before: "2024-01-15T21:00:00+09:00" });

    expect(afterMidnight.map(result => result.card_id)).toEqual([card.id]);
    expect(afterFraction).toEqual([]);
    expect(afterOffsetEqual.map(result => result.card_id)).toEqual([card.id]);
    expect(beforeFractionAfter.map(result => result.card_id)).toEqual([card.id]);
    expect(beforeFractionBefore).toEqual([]);
    expect(beforeOffsetEqual.map(result => result.card_id)).toEqual([card.id]);
  });
});

describe("U6 Jev search scope with SQLite aliases", () => {
  it("keeps an in-scope alias seed and every Jev payload inside the requested subtree", async () => {
    const db = getDb();
    const rootCard = await insertCard(db, { card_type: "structure", title: "Requested Scope", content: null });
    const rootNode = await insertNode(db, rootCard.id, null, 1);
    const outsideParentCard = await insertCard(db, { card_type: "structure", title: "Outside Canonical Parent", content: null });
    const outsideParentNode = await insertNode(db, outsideParentCard.id, null, 2);
    const targetCard = await insertCard(db, { card_type: "knowledge", title: "Alias Match", content: "u6aliasneedle" });
    const canonicalNode = await insertNode(db, targetCard.id, outsideParentNode.id, 1);
    const siblingCard = await insertCard(db, { card_type: "knowledge", title: "Outside Sibling", content: "unrelated sibling text" });
    const siblingNode = await insertNode(db, siblingCard.id, outsideParentNode.id, 2);
    const aliasNode = await insertNode(db, targetCard.id, rootNode.id, 1, true);
    const payloads: JevMeaningPayload[] = [];

    const response = await searchWithJev({ query: "u6aliasneedle", root_node_id: rootNode.id, exhaustive: true }, {
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
            noul: key === "sufficiency_0" ? 0.1 : 0.9,
          }])),
        };
      },
      policy: { ...JEV_SEARCH_POLICY },
    });

    const allPayloads = JSON.stringify(payloads);
    const trace = JSON.stringify(response.trace);
    expect(allPayloads).not.toContain(outsideParentNode.id);
    expect(allPayloads).not.toContain(siblingNode.id);
    expect(allPayloads).not.toContain(outsideParentCard.title);
    expect(allPayloads).not.toContain(siblingCard.title);
    expect(trace).not.toContain(outsideParentNode.id);
    expect(trace).not.toContain(siblingNode.id);
    expect(response.results.map(result => result.node_id)).toEqual([aliasNode.id]);
    expect(response.results.every(result => result.node_id === rootNode.id || result.node_id === aliasNode.id)).toBe(true);
    expect(canonicalNode.id).not.toBe(aliasNode.id);
  });
});
