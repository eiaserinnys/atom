import path from "path";
import { fileURLToPath } from "url";

import bcrypt from "bcryptjs";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";

import { agentKeyVerifier } from "../../src/api/agent-key-auth.js";
import { authMiddleware } from "../../src/api/middleware/auth.js";
import { cardApiRoutes } from "../../src/api/routes/card_api.js";
import { cardRoutes } from "../../src/api/routes/cards.js";
import { treeRoutes } from "../../src/api/routes/tree.js";
import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import { closeDb, setDb } from "../../src/db/client.js";
import { insertAgent } from "../../src/db/queries/agents.js";
import { createCard } from "../../src/services/card.service.js";

// Browser routes (/tree/*, /cards/*, bypass mode) against agent routes (/api/tree/*,
// /api/cards/*, x-api-key). The pairs share handlers or services but differ in query
// parsing and body validation. Only HTTP status and body are asserted. Ids and
// timestamps are masked, and created_by/updated_by are left out on purpose.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations-sqlite");
const KEY = "route-pair-contract-key";
const KEY_HEADERS = { "x-api-key": KEY };
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000123";
const originalEnv = { ...process.env };

let db: SqliteAdapter;
let app: FastifyInstance;
let ids: { root: string; a: string; sandbox: string };

// Root > A > B > C > D (knowledge), Root > K (knowledge). Bodies are "body of <title>".
const LEVELS: Array<[number, string]> = [[0, "Root"], [1, "A"], [2, "B"], [3, "C"], [4, "D"], [1, "K"]];
function expectedMarkdown(maxDepth: number, opts: { numbered?: boolean; skip?: string[] } = {}): string {
  const lines: string[] = [];
  const counters: number[] = [];
  let skipBelow: number | null = null;
  for (const [depth, title] of LEVELS) {
    if (skipBelow !== null && depth > skipBelow) continue;
    skipBelow = null;
    if (opts.skip?.includes(title)) { skipBelow = depth; continue; }
    if (depth > maxDepth) continue;
    counters.length = depth;
    counters[depth - 1] = (counters[depth - 1] ?? 0) + 1;
    const number = opts.numbered && depth > 0 ? `${counters.slice(0, depth).join(".")} ` : "";
    lines.push(`${"#".repeat(depth + 1)} ${number}${title}`, `body of ${title}`);
  }
  return lines.join("\n");
}

beforeAll(async () => {
  process.env["JWT_SECRET"] = "route-pair-contract-secret";
  delete process.env["GOOGLE_CLIENT_ID"];
  delete process.env["SLACK_CLIENT_ID"];
  delete process.env["DASHBOARD_ADMIN_PASSWORD"];
  process.env["AUTH_BYPASS"] = "1";
  db = new SqliteAdapter(":memory:");
  setDb(db);
  await db.runMigrations(MIGRATIONS_DIR);
  await insertAgent(db, { agent_id: "route-pair", secret_hash: await bcrypt.hash(KEY, 4), scope: "write" });
  const make = (title: string, parent: string | null, type: "structure" | "knowledge") =>
    createCard({ card_type: type, title, content: `body of ${title}`, parent_node_id: parent });
  const root = await make("Root", null, "structure");
  const a = await make("A", root.node_id, "structure");
  const b = await make("B", a.node_id, "structure");
  const c = await make("C", b.node_id, "structure");
  await make("D", c.node_id, "knowledge");
  await make("K", root.node_id, "knowledge");
  // Separate root so tests that create cards do not change the Root tree above.
  const sandbox = await make("Sandbox", null, "structure");
  ids = { root: root.node_id, a: a.node_id, sandbox: sandbox.node_id };
});

afterAll(async () => {
  await closeDb();
  process.env = { ...originalEnv };
});

beforeEach(async () => {
  agentKeyVerifier.clear();
  app = Fastify({ logger: false });
  await app.register(cookie);
  app.addHook("preHandler", authMiddleware);
  await app.register(cardRoutes);
  await app.register(treeRoutes);
  await app.register(cardApiRoutes);
});

afterEach(async () => {
  await app.close();
});

const browserGet = (url: string) => app.inject({ method: "GET", url });
const agentGet = (url: string) => app.inject({ method: "GET", url: `/api${url}`, headers: KEY_HEADERS });
const outcome = (res: LightMyRequestResponse) => ({ status: res.statusCode, body: res.json() });
const compile = async (query: string) => {
  const [browser, agent] = await Promise.all([
    browserGet(`/tree/${ids.root}/compile?include_ids=false${query}`),
    agentGet(`/tree/${ids.root}/compile?include_ids=false${query}`),
  ]);
  return { browser: outcome(browser), agent: outcome(agent) };
};
const md = (markdown: string) => ({ status: 200, body: { markdown } });

describe("read pairs that answer identically", () => {
  it("lists the root nodes and the children of a node with the same body", async () => {
    const [browserRoots, agentRoots] = [outcome(await browserGet("/tree")), outcome(await agentGet("/tree"))];
    expect(browserRoots.status).toBe(200);
    expect(agentRoots).toEqual(browserRoots);
    const [browserKids, agentKids] = [
      outcome(await browserGet(`/tree/${ids.root}/children`)),
      outcome(await agentGet(`/tree/${ids.root}/children`)),
    ];
    expect(browserKids.status).toBe(200);
    expect(browserKids.body.map((n: { card: { title: string } }) => n.card.title)).toEqual(["A", "K"]);
    expect(agentKids).toEqual(browserKids);
  });

  it("answers an unknown parent with the same 404 on both", async () => {
    const notFound = { status: 404, body: { error: `Node not found: ${UNKNOWN_ID}`, code: "NODE_NOT_FOUND" } };
    expect(outcome(await browserGet(`/tree/${UNKNOWN_ID}/children`))).toEqual(notFound);
    expect(outcome(await agentGet(`/tree/${UNKNOWN_ID}/children`))).toEqual(notFound);
  });

  it("serves the same outline and the same boundary error", async () => {
    const [browserOutline, agentOutline] = [
      outcome(await browserGet(`/tree/outline?node_id=${ids.root}&depth=3&excerpt_chars=5`)),
      outcome(await agentGet(`/tree/outline?node_id=${ids.root}&depth=3&excerpt_chars=5`)),
    ];
    expect(browserOutline.status).toBe(200);
    expect(browserOutline.body.nodes.map((n: { title: string }) => n.title)).toEqual(["A", "K"]);
    expect(agentOutline).toEqual(browserOutline);
    const [browserBad, agentBad] = [outcome(await browserGet("/tree/outline?depth=0")), outcome(await agentGet("/tree/outline?depth=0"))];
    expect(browserBad).toEqual({ status: 400, body: { error: "depth must be an integer between 1 and 10" } });
    expect(agentBad).toEqual(browserBad);
  });
});

describe("compile pair: same result", () => {
  it.each([
    ["?depth=0", 0],
    ["?depth=1", 1],
    ["?depth=2", 2],
    ["?depth=3", 3],
    ["?depth=Infinity", 4],
    ["?depth=2abc", 2],
  ])("depth query %s", async (_label, expectedDepth) => {
    const query = _label.replace("?", "&");
    const { browser, agent } = await compile(query);
    expect(browser).toEqual(md(expectedMarkdown(expectedDepth)));
    expect(agent).toEqual(browser);
  });

  it("rejects a negative depth on both with the same 400", async () => {
    const { browser, agent } = await compile("&depth=-1");
    expect(browser).toEqual({
      status: 400,
      body: { error: "Invalid depth: -1 (0 or more; omit or null for unlimited)", code: "INVALID_INPUT" },
    });
    expect(agent).toEqual(browser);
  });

  it("applies max_chars, ignores a non-numeric max_chars, and rejects a bad limit on both", async () => {
    const { browser: cut, agent: cutAgent } = await compile("&depth=Infinity&max_chars=12");
    expect(cut.status).toBe(200);
    expect(cut.body.markdown).toMatch(/<!-- truncated: \d+ chars omitted -->$/);
    expect(cutAgent).toEqual(cut);
    const { browser: ignored, agent: ignoredAgent } = await compile("&depth=Infinity&max_chars=abc");
    expect(ignored).toEqual(md(expectedMarkdown(4)));
    expect(ignoredAgent).toEqual(ignored);
    const { browser: bad, agent: badAgent } = await compile("&limit=oops");
    expect(bad).toEqual({ status: 400, body: { error: "limit must be a positive safe integer" } });
    expect(badAgent).toEqual(bad);
  });

  it("keeps titles_only output the same where the depth matches, and fails the same on an unknown node", async () => {
    const [browser, agent] = await Promise.all([
      browserGet(`/tree/${ids.root}/compile?include_ids=false&titles_only=true&depth=1`),
      agentGet(`/tree/${ids.root}/compile?include_ids=false&titles_only=true&depth=1`),
    ]);
    expect(outcome(agent)).toEqual(outcome(browser));
    expect(browser.json<{ markdown: string }>().markdown).toContain("A");
    const [missingBrowser, missingAgent] = await Promise.all([
      browserGet(`/tree/${UNKNOWN_ID}/compile`),
      agentGet(`/tree/${UNKNOWN_ID}/compile`),
    ]);
    expect(missingBrowser.statusCode).toBe(404);
    expect(missingAgent.statusCode).toBe(404);
    expect(missingBrowser.json()).toEqual({ error: `Node not found: ${UNKNOWN_ID}`, code: "NODE_NOT_FOUND" });
    expect(missingAgent.json()).toEqual(missingBrowser.json());
  });
});

describe("compile pair: differences that clients may rely on", () => {
  it("defaults to depth 3 on the browser route and depth 2 on the agent route (README documents this)", async () => {
    const { browser, agent } = await compile("");
    expect(browser).toEqual(md(expectedMarkdown(3)));
    expect(agent).toEqual(md(expectedMarkdown(2)));
  });

  it("reads an unparseable depth as 3 on the browser route and as unlimited on the agent route", async () => {
    for (const query of ["&depth=abc", "&depth="]) {
      const { browser, agent } = await compile(query);
      expect([query, browser]).toEqual([query, md(expectedMarkdown(3))]);
      expect([query, agent]).toEqual([query, md(expectedMarkdown(4))]);
    }
  });

  it("honours numbering and exclude_nodes only on the browser route", async () => {
    const numbered = await compile("&depth=Infinity&numbering=true");
    expect(numbered.browser).toEqual(md(expectedMarkdown(4, { numbered: true })));
    expect(numbered.agent).toEqual(md(expectedMarkdown(4)));
    const excluded = await compile(`&depth=Infinity&exclude_nodes=${ids.a}`);
    expect(excluded.browser).toEqual(md(expectedMarkdown(4, { skip: ["A"] })));
    expect(excluded.agent).toEqual(md(expectedMarkdown(4)));
  });
});

describe("card create pair (POST /cards, POST /api/cards)", () => {
  const stable = (card: Record<string, unknown>) => {
    const { id, node_id, card_timestamp, updated_at, created_by, updated_by, content_timestamp, ...rest } = card;
    expect([typeof id, typeof node_id]).toEqual(["string", "string"]);
    return rest;
  };

  it("creates the same card under the requested parent", async () => {
    const payload = {
      card_type: "knowledge", title: "pair create", content: "c", parent_node_id: ids.sandbox,
      tags: ["t1"], references: [], source_type: "manual", source_ref: "ref-1",
    };
    const viaBrowser = await app.inject({ method: "POST", url: "/cards", payload });
    const viaAgent = await app.inject({ method: "POST", url: "/api/cards", headers: KEY_HEADERS, payload });
    expect([viaBrowser.statusCode, viaAgent.statusCode]).toEqual([201, 201]);
    expect(stable(viaAgent.json())).toEqual(stable(viaBrowser.json()));
    expect(stable(viaBrowser.json())).toMatchObject({ card_type: "knowledge", title: "pair create", tags: ["t1"], version: 1 });
    const kids = outcome(await browserGet(`/tree/${ids.sandbox}/children`)).body.map((n: { card: { title: string } }) => n.card.title);
    expect(kids.filter((t: string) => t === "pair create")).toHaveLength(2);
  });

  it("validates the title and defaults card_type to knowledge on the agent route", async () => {
    const required = { status: 400, body: { error: "title is required (a string of 1-50 characters)", code: "INVALID_INPUT" } };
    const missing = await app.inject({ method: "POST", url: "/api/cards", headers: KEY_HEADERS, payload: { card_type: "knowledge" } });
    expect(outcome(missing)).toEqual(required);
    const numeric = await app.inject({ method: "POST", url: "/api/cards", headers: KEY_HEADERS, payload: { title: 5 } });
    expect(outcome(numeric)).toEqual(required);
    const defaulted = await app.inject({ method: "POST", url: "/api/cards", headers: KEY_HEADERS, payload: { title: "defaulted type" } });
    expect(defaulted.statusCode).toBe(201);
    expect(defaulted.json()).toMatchObject({ card_type: "knowledge", title: "defaulted type" });
  });
});

describe("card update pair (PUT /cards/:id, PATCH /api/cards/:id)", () => {
  const createOne = async (title: string) =>
    (await createCard({ card_type: "knowledge", title, content: "orig" })).card;

  it("wraps the PUT result as {card, conflict:false} and returns the bare card from PATCH", async () => {
    const forPut = await createOne("pair put");
    const forPatch = await createOne("pair patch");
    const put = await app.inject({ method: "PUT", url: `/cards/${forPut.id}`, payload: { content: "v2", expected_version: 1 } });
    const patch = await app.inject({ method: "PATCH", url: `/api/cards/${forPatch.id}`, headers: KEY_HEADERS, payload: { content: "v2", expected_version: 1 } });
    expect([put.statusCode, patch.statusCode]).toEqual([200, 200]);
    expect(Object.keys(put.json()).sort()).toEqual(["card", "conflict"]);
    expect(put.json().conflict).toBe(false);
    expect(put.json().card).toMatchObject({ id: forPut.id, content: "v2", version: 2 });
    expect(patch.json()).toMatchObject({ id: forPatch.id, content: "v2", version: 2 });
    expect(patch.json()).not.toHaveProperty("card");
  });

  it("answers a stale version with the same 409 and an unknown card with the same 404", async () => {
    const card = await createOne("pair conflict");
    await app.inject({ method: "PUT", url: `/cards/${card.id}`, payload: { content: "v2", expected_version: 1 } });
    const stale = { content: "stale", expected_version: 1 };
    const put = await app.inject({ method: "PUT", url: `/cards/${card.id}`, payload: stale });
    const patch = await app.inject({ method: "PATCH", url: `/api/cards/${card.id}`, headers: KEY_HEADERS, payload: stale });
    expect(outcome(put)).toEqual({ status: 409, body: {
      error: "VERSION_CONFLICT",
      code: "VERSION_CONFLICT",
      current_version: 2,
      message: `VersionConflict: card ${card.id} expected version 1, actual 2. Re-read the card with get_card, merge your change into the latest content, and retry with its version as expected_version.`,
    } });
    expect(outcome(patch)).toEqual(outcome(put));
    const missingPut = await app.inject({ method: "PUT", url: `/cards/${UNKNOWN_ID}`, payload: { title: "x" } });
    const missingPatch = await app.inject({ method: "PATCH", url: `/api/cards/${UNKNOWN_ID}`, headers: KEY_HEADERS, payload: { title: "x" } });
    expect(outcome(missingPut)).toEqual({ status: 404, body: { error: `Card not found: ${UNKNOWN_ID}`, code: "CARD_NOT_FOUND" } });
    expect(outcome(missingPatch)).toEqual(outcome(missingPut));
  });

  it("lets PATCH write references and source_type like PUT, and rejects an unknown field with 400", async () => {
    const forPut = await createOne("pair fields put");
    const forPatch = await createOne("pair fields patch");
    const fields = { source_type: "manual", references: [forPut.id] };
    const put = await app.inject({ method: "PUT", url: `/cards/${forPut.id}`, payload: fields });
    const patch = await app.inject({ method: "PATCH", url: `/api/cards/${forPatch.id}`, headers: KEY_HEADERS, payload: fields });
    expect([put.statusCode, patch.statusCode]).toEqual([200, 200]);
    expect(patch.json()).toMatchObject({ source_type: "manual", references: [forPut.id], version: 2 });
    expect(patch.json()).toMatchObject({ source_type: put.json().card.source_type, references: put.json().card.references });

    const unknown = await app.inject({ method: "PATCH", url: `/api/cards/${forPatch.id}`, headers: KEY_HEADERS, payload: { notAField: 1 } });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json()).toMatchObject({ code: "INVALID_INPUT" });
    expect(unknown.json().error).toContain("Unknown card update field: notAField");
  });

  it("counts an empty update as a version bump on both routes", async () => {
    const forPut = await createOne("pair empty put");
    const forPatch = await createOne("pair empty patch");
    const put = await app.inject({ method: "PUT", url: `/cards/${forPut.id}`, payload: {} });
    const patch = await app.inject({ method: "PATCH", url: `/api/cards/${forPatch.id}`, headers: KEY_HEADERS, payload: {} });
    expect(put.json().card.version).toBe(2);
    expect(patch.json().version).toBe(2);
  });
});

describe("depth query on the other browser compile routes (sections, find)", () => {
  // Same parsing as the browser compile route: Infinity and digits are honoured, anything
  // unparseable or missing falls back to 3.
  // Sections come in document (depth-first) order; GET sections numbers the headings, POST does not.
  const BFS: Array<[number, string, string]> = [
    [0, "Root", "Root"], [1, "A", "1 A"], [2, "B", "1.1 B"], [3, "C", "1.1.1 C"], [4, "D", "1.1.1.1 D"], [1, "K", "2 K"],
  ];
  const titlesUpTo = (maxDepth: number, numbered = true) =>
    BFS.filter(([depth]) => depth <= maxDepth).map(([, plain, withNumber]) => (numbered ? withNumber : plain));
  it.each([
    ["", 3],
    ["&depth=0", 0],
    ["&depth=1", 1],
    ["&depth=Infinity", 4],
    ["&depth=2abc", 2],
    ["&depth=abc", 3],
    ["&depth=", 3],
  ])("sections and find with %s", async (query, expectedDepth) => {
    const sections = await browserGet(`/tree/${ids.root}/compile/sections?head_chars=0${query}`);
    expect(sections.statusCode).toBe(200);
    expect(sections.json<{ sections: Array<{ title: string }> }>().sections.map((s) => s.title)).toEqual(titlesUpTo(expectedDepth));
    const found = await browserGet(`/tree/${ids.root}/compile/find?q=body${query}`);
    expect(found.statusCode).toBe(200);
    expect(found.json<{ total: number }>().total).toBe(titlesUpTo(expectedDepth).length);
  });

  it("takes depth null as unlimited and a number as given in the POST body of sections", async () => {
    const post = (payload: object) => app.inject({ method: "POST", url: `/tree/${ids.root}/compile/sections`, payload });
    const titles = async (payload: object) => (await post(payload)).json<{ sections: Array<{ title: string }> }>().sections.map((s) => s.title);
    expect(await titles({ depth: null })).toEqual(titlesUpTo(4, false));
    expect(await titles({ depth: 1 })).toEqual(titlesUpTo(1, false));
    expect(await titles({})).toEqual(titlesUpTo(3, false));
    expect(await titles({ depth: "2" })).toEqual(titlesUpTo(3, false));
  });
});
