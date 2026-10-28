import { compileNode, compileSections } from "../../src/shared/bfs.js";
import type { CompileSection, ResolvedRef } from "../../src/shared/bfs.js";
import type { Card, TreeNode } from "../../src/shared/types.js";
import { makeCard, makeNode } from "./bfs-fixtures.js";

function makeFixture() {
  const cards = new Map<string, Card>([
    ["card-root", makeCard({ id: "card-root", title: "Root", content: "# Root body heading\nroot body", version: 4 })],
    ["card-child", makeCard({ id: "card-child", title: "Child", content: "## Child body heading\nchild body", version: 7 })],
  ]);
  const nodes = new Map<string, TreeNode>([
    ["node-root", makeNode({ id: "node-root", card_id: "card-root" })],
    ["node-child", makeNode({ id: "node-child", card_id: "card-child", parent_node_id: "node-root", position: 100 })],
    ["node-cycle", makeNode({ id: "node-cycle", card_id: "card-root", parent_node_id: "node-child", position: 100, is_symlink: true })],
  ]);
  const getNodeCard = (nodeId: string) => {
    const node = nodes.get(nodeId)!;
    return { card_id: node.card_id, is_symlink: node.is_symlink };
  };
  const getChildren = (nodeId: string) => Array.from(nodes.values())
    .filter((node) => node.parent_node_id === nodeId)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const getCard = (cardId: string) => cards.get(cardId)!;
  return { cards, nodes, getNodeCard, getChildren, getCard };
}

function sectionsMarkdown(sections: CompileSection[]): string {
  return sections.map((section) => {
    const lines = [section.heading];
    if (section.content) lines.push(section.content);
    if (section.unfurl_text) lines.push(section.unfurl_text);
    return lines.join("\n");
  }).join("\n");
}

describe("compileSections", () => {
  it.each([
    ["default metadata", {}],
    ["numbered metadata", { numbering: true, includeIds: true }],
  ] as const)("joins to compileNode output with %s options", (_name, options) => {
    const fixture = makeFixture();
    const sections = compileSections(
      "node-root", fixture.getNodeCard, fixture.getChildren, fixture.getCard, Infinity, options
    );
    const markdown = compileNode(
      "node-root", fixture.getNodeCard, fixture.getChildren, fixture.getCard,
      Infinity, new Set(), 1, options
    );

    expect(sectionsMarkdown(sections)).toBe(markdown);
  });

  it("exposes section identity, display headings, body headings, and cycle state", () => {
    const fixture = makeFixture();
    const emitted: string[] = [];
    const sections = compileSections(
      "node-root",
      fixture.getNodeCard,
      fixture.getChildren,
      fixture.getCard,
      Infinity,
      { numbering: true, includeIds: true, onCardEmitted: (cardId) => emitted.push(cardId) }
    );

    expect(sections).toMatchObject([
      {
        index: 0, node_id: "node-root", card_id: "card-root", card_version: 4,
        depth: 0, level: 1, title: "Root", cycle: false, chars: 29,
        headings: [{ level: 1, text: "Root body heading" }],
      },
      {
        index: 1, node_id: "node-child", card_id: "card-child", card_version: 7,
        depth: 1, level: 2, title: "1 Child", cycle: false,
        headings: [{ level: 2, text: "Child body heading" }],
      },
      {
        index: 2, node_id: "node-cycle", card_id: "card-root",
        depth: 2, level: 3, title: "1.1 Root (cycle)", cycle: true,
        chars: 0, content: null, headings: [],
      },
    ]);
    expect(sections[0]?.heading).toMatch(/^# Root <!-- node:node-root card:card-root depth:0/);
    expect(sections[1]?.heading).toMatch(/^## 1 Child <!-- node:node-child card:card-child depth:1/);
    expect(sections[2]?.heading).toBe("### 1.1 Root *(cycle)*");
    expect(emitted).toEqual(["card-root", "card-child"]);
  });

  it("uses the same child selection and numbering for limit and exclusion options", () => {
    const fixture = makeFixture();
    const options = { numbering: true, limit: 1 };
    const sections = compileSections(
      "node-root", fixture.getNodeCard, fixture.getChildren, fixture.getCard, Infinity, options
    );
    const markdown = compileNode(
      "node-root", fixture.getNodeCard, fixture.getChildren, fixture.getCard,
      Infinity, new Set(), 1, options
    );
    expect(sectionsMarkdown(sections)).toBe(markdown);

    const excludedOptions = { excludeNodes: new Set(["node-child"]) };
    const excludedSections = compileSections(
      "node-root", fixture.getNodeCard, fixture.getChildren, fixture.getCard, Infinity, excludedOptions
    );
    expect(excludedSections.map((section) => section.node_id)).toEqual(["node-root"]);
  });

  it("places resolved reference text after its card body", () => {
    const fixture = makeFixture();
    const options = {
      resolvedRefs: new Map<string, ResolvedRef>([["card-child", {
        ok: true,
        result: { text: "preview text", snapshot: "{}", unfurlData: null },
        sourceType: "test-ref",
      }]]),
    };
    const sections = compileSections(
      "node-root", fixture.getNodeCard, fixture.getChildren, fixture.getCard, Infinity, options
    );
    const markdown = compileNode(
      "node-root", fixture.getNodeCard, fixture.getChildren, fixture.getCard,
      Infinity, new Set(), 1, options
    );

    expect(sections[1]?.unfurl_text).toBe("preview text");
    expect(sectionsMarkdown(sections)).toBe(markdown);
  });
});
