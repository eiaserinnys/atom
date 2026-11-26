import type { FastifyInstance } from "fastify";

import { cardApiRoutes } from "../../src/api/routes/card_api.js";
import { closeDb } from "../../src/db/client.js";
import { compileSubtree, compileSubtreeSections, updateNodeProperties } from "../../src/services/tree.service.js";
import { browserApp, makeCard, McpSession, openMcp, openMemoryDb, UNKNOWN_ID, WRITE_HEADERS } from "./sqlite-app-harness.js";

// compile says what it left out, keeps its first line whole under a small max_chars,
// and rejects a negative depth.

beforeAll(async () => {
  await openMemoryDb();
});
afterAll(async () => {
  await closeDb();
});

let seq = 0;
async function parentWithChildren(count: number, journalLimit: number | null = null) {
  const parent = await makeCard(`omit parent ${++seq}`, null, "parent body");
  const children = [];
  for (let i = 1; i <= count; i++) children.push(await makeCard(`omit child ${seq}-${i}`, parent.nodeId, `child body ${i}`));
  if (journalLimit !== null) await updateNodeProperties(parent.nodeId, { journal_limit: journalLimit });
  return { parent, children, tag: seq };
}

const markers = (markdown: string) => markdown.split("\n").filter((line) => line.includes("<!-- omitted:"));

describe("journal_limit", () => {
  it("heading mode: one line under the parent says how many older children are left out", async () => {
    const { parent, tag } = await parentWithChildren(4, 2);
    const { markdown } = await compileSubtree(parent.nodeId, 2, { includeIds: false });
    expect(markdown).toBe([
      `# omit parent ${tag}`, "parent body",
      "<!-- omitted: 2 older children (journal_limit 2) -->",
      `## omit child ${tag}-3`, "child body 3",
      `## omit child ${tag}-4`, "child body 4",
    ].join("\n"));
  });

  it("titles_only: the line sits at the indentation of the children, even with ids", async () => {
    const { parent, tag } = await parentWithChildren(4, 2);
    const { markdown } = await compileSubtree(parent.nodeId, 2, { titlesOnly: true });
    const lines = markdown.split("\n");
    expect(lines[1]).toBe("  <!-- omitted: 2 older children (journal_limit 2) -->");
    expect(lines[2]).toMatch(new RegExp(`^  ├── omit child ${tag}-3 \\[node:`));
    expect(lines).toHaveLength(4);
  });

  it("says '1 older child' for one", async () => {
    const { parent } = await parentWithChildren(3, 2);
    const { markdown } = await compileSubtree(parent.nodeId, 1, { titlesOnly: true, includeIds: false });
    expect(markers(markdown)).toEqual(["  <!-- omitted: 1 older child (journal_limit 2) -->"]);
  });

  it("adds nothing when nothing was left out", async () => {
    const cases: Array<[string, number, number | null]> = [
      ["no limit", 3, null], ["limit 0 means all", 3, 0], ["limit equal to the count", 3, 3], ["limit above the count", 3, 9],
    ];
    for (const [label, count, limit] of cases) {
      const { parent } = await parentWithChildren(count, limit);
      for (const titlesOnly of [false, true]) {
        const { markdown } = await compileSubtree(parent.nodeId, 2, { titlesOnly });
        expect([label, titlesOnly, markers(markdown)]).toEqual([label, titlesOnly, []]);
      }
    }
  });

  it("adds nothing when the depth does not reach the children", async () => {
    const { parent } = await parentWithChildren(4, 2);
    const { markdown } = await compileSubtree(parent.nodeId, 0);
    expect(markers(markdown)).toEqual([]);
  });

  it("marks each limited node of a nested tree under its own heading", async () => {
    const { parent, children, tag } = await parentWithChildren(1);
    const inner = children[0]!;
    for (let i = 1; i <= 3; i++) await makeCard(`omit grand ${tag}-${i}`, inner.nodeId);
    await updateNodeProperties(inner.nodeId, { journal_limit: 1 });
    const { markdown } = await compileSubtree(parent.nodeId, 3, { titlesOnly: true, includeIds: false });
    expect(markdown.split("\n")).toEqual([
      `omit parent ${tag} (11 chars)`,
      `  ├── omit child ${tag}-1 (12 chars)`,
      "    <!-- omitted: 2 older children (journal_limit 1) -->",
      `    ├── omit grand ${tag}-3 (19 chars)`,
    ]);
  });

  it("leaves the sections the dashboard reads as they were", async () => {
    const { parent } = await parentWithChildren(4, 2);
    const { sections } = await compileSubtreeSections(parent.nodeId, 2);
    expect(sections).toHaveLength(3);
    expect(sections.every((section) => !section.heading.includes("omitted"))).toBe(true);
  });
});

describe("compile limit", () => {
  it.each([[false], [true]])("titlesOnly=%s: says how many direct children the limit cut", async (titlesOnly) => {
    const { parent } = await parentWithChildren(5);
    const { markdown } = await compileSubtree(parent.nodeId, 2, { titlesOnly, limit: 2 });
    const found = markers(markdown);
    expect(found).toHaveLength(1);
    expect(found[0]!.trim()).toBe("<!-- omitted: 3 children (limit 2) -->");
    if (titlesOnly) expect(found[0]).toMatch(/^ {2}<!--/);
  });

  it("adds nothing when the limit cuts nothing, and counts a single cut child as 'child'", async () => {
    const { parent } = await parentWithChildren(3);
    expect(markers((await compileSubtree(parent.nodeId, 2, { limit: 3 })).markdown)).toEqual([]);
    expect(markers((await compileSubtree(parent.nodeId, 2, { limit: 9 })).markdown)).toEqual([]);
    expect(markers((await compileSubtree(parent.nodeId, 2, { limit: 2 })).markdown)).toEqual(["<!-- omitted: 1 child (limit 2) -->"]);
  });

  it("with a journal_limit as well, each line counts what its own rule left out", async () => {
    const { parent } = await parentWithChildren(6, 4);
    const { markdown } = await compileSubtree(parent.nodeId, 2, { limit: 3 });
    expect(markers(markdown)).toEqual([
      "<!-- omitted: 2 older children (journal_limit 4) -->",
      "<!-- omitted: 1 child (limit 3) -->",
    ]);
  });

  it("does not touch the output of a deeper level", async () => {
    const { parent, children, tag } = await parentWithChildren(1);
    for (let i = 1; i <= 3; i++) await makeCard(`omit deep ${tag}-${i}`, children[0]!.nodeId);
    const { markdown } = await compileSubtree(parent.nodeId, 3, { limit: 1 });
    expect(markers(markdown)).toEqual([]);
  });
});

describe("max_chars", () => {
  const full = (parentNodeId: string) => compileSubtree(parentNodeId, 2, {});
  const LINE_COMMENT = /^## .*<!-- node:\S+ card:\S+ depth:1 .*-->$/;

  it("keeps the first line whole when max_chars is smaller than it", async () => {
    const { parent } = await parentWithChildren(2);
    const whole = (await full(parent.nodeId)).markdown;
    const firstLine = whole.split("\n")[0]!;
    for (const maxChars of [1, 12, firstLine.length - 1, firstLine.length]) {
      const { markdown } = await compileSubtree(parent.nodeId, 2, { maxChars });
      expect([maxChars, markdown.split("\n")[0]]).toEqual([maxChars, firstLine]);
      expect(markdown.endsWith(`\n<!-- truncated: ${whole.length - firstLine.length} chars omitted -->`)).toBe(true);
    }
    expect(firstLine.startsWith("# omit parent")).toBe(true);
    expect(LINE_COMMENT.test(firstLine)).toBe(false);
  });

  it("still cuts on the last line boundary that fits within max_chars", async () => {
    const { parent } = await parentWithChildren(3);
    const whole = (await full(parent.nodeId)).markdown;
    const lines = whole.split("\n");
    const kept = (count: number) => lines.slice(0, count).join("\n");
    const cut = (count: number) => `${kept(count)}\n<!-- truncated: ${whole.length - kept(count).length} chars omitted -->`;
    const cases: Array<[number, string]> = [
      [kept(3).length - 1, cut(2)],
      [kept(3).length, cut(2)],
      [kept(3).length + 1, cut(3)],
      [kept(3).length + 5, cut(3)],
    ];
    for (const [maxChars, expected] of cases) {
      expect([maxChars, (await compileSubtree(parent.nodeId, 2, { maxChars })).markdown]).toEqual([maxChars, expected]);
    }
  });

  it("returns everything when the text fits, or when max_chars is 0 or negative", async () => {
    const { parent } = await parentWithChildren(2);
    const whole = (await full(parent.nodeId)).markdown;
    for (const maxChars of [whole.length, whole.length + 100, 0, -1, -50]) {
      expect([maxChars, (await compileSubtree(parent.nodeId, 2, { maxChars })).markdown]).toEqual([maxChars, whole]);
    }
  });

  it("does not add a truncation line to a one-line result", async () => {
    const { parent } = await parentWithChildren(1);
    const single = (await compileSubtree(parent.nodeId, 0, { titlesOnly: true })).markdown;
    expect(single).not.toContain("\n");
    expect((await compileSubtree(parent.nodeId, 0, { titlesOnly: true, maxChars: 3 })).markdown).toBe(single);
  });
});

describe("depth", () => {
  let app: FastifyInstance;
  let mcp: McpSession;
  beforeEach(async () => {
    app = browserApp();
    await app.register(cardApiRoutes);
    mcp = await openMcp("read");
  });
  afterEach(async () => {
    await app.close();
    await mcp.close();
  });

  const MESSAGE = "Invalid depth: -1 (0 or more; omit or null for unlimited)";

  it("MCP rejects a negative depth with a message that says what to do", async () => {
    const { parent } = await parentWithChildren(1);
    expect(await mcp.call("compile_subtree", { node_id: parent.nodeId, depth: -1 })).toEqual({ isError: true, text: MESSAGE });
  });

  it("REST rejects it with 400, before looking the node up", async () => {
    const res = await app.inject({ method: "GET", url: `/api/tree/${UNKNOWN_ID}/compile?depth=-1`, headers: WRITE_HEADERS });
    expect([res.statusCode, res.json()]).toEqual([400, { error: MESSAGE, code: "INVALID_INPUT" }]);
  });

  it("keeps null (unlimited) and 0 or more as they were", async () => {
    const { parent, tag } = await parentWithChildren(1);
    const unlimited = await mcp.call("compile_subtree", { node_id: parent.nodeId, depth: null, include_ids: false });
    expect(unlimited.text).toContain(`omit child ${tag}-1`);
    const zero = await mcp.call("compile_subtree", { node_id: parent.nodeId, depth: 0, include_ids: false });
    expect(zero.text).not.toContain(`omit child ${tag}-1`);
    const rest = await app.inject({ method: "GET", url: `/api/tree/${parent.nodeId}/compile?depth=0&include_ids=false`, headers: WRITE_HEADERS });
    expect(rest.statusCode).toBe(200);
  });
});
