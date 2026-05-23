import { compileNode } from "../../src/shared/bfs.js";
import type { Card, TreeNode } from "../../src/shared/types.js";
import { makeCard, makeNode } from "./bfs-fixtures.js";

describe("BFS compileNode", () => {
  describe("titlesOnly option", () => {
    const cards = new Map<string, Card>([
      ["card-a", makeCard({ id: "card-a", title: "Root", content: "Root content here" })],
      ["card-b", makeCard({ id: "card-b", title: "Child", content: "Child content" })],
      ["card-c", makeCard({ id: "card-c", title: "Grandchild", content: null })],
    ]);
    const nodes = new Map<string, TreeNode>([
      ["node-a", makeNode({ id: "node-a", card_id: "card-a" })],
      ["node-b", makeNode({ id: "node-b", card_id: "card-b", parent_node_id: "node-a", position: 100 })],
      ["node-c", makeNode({ id: "node-c", card_id: "card-c", parent_node_id: "node-b", position: 100 })],
    ]);
    const getChildren = (nid: string): TreeNode[] =>
      Array.from(nodes.values())
        .filter((n) => n.parent_node_id === nid)
        .sort((a, b) => a.position - b.position);
    const getNodeCard = (nid: string) => ({
      card_id: nodes.get(nid)!.card_id,
      is_symlink: nodes.get(nid)!.is_symlink,
    });
    const getCard = (cid: string) => cards.get(cid)!;

    it("omits content and outputs indented tree", () => {
      const result = compileNode(
        "node-a", getNodeCard, getChildren, getCard,
        2, new Set(), 1, { titlesOnly: true }
      );

      expect(result).not.toContain("Root content here");
      expect(result).not.toContain("Child content");
      expect(result).not.toContain("#");
      expect(result).toContain("Root");
      expect(result).toContain("├── Child");
      expect(result).toContain("├── Grandchild");
    });

    it("includes chars metadata by default", () => {
      const result = compileNode(
        "node-a", getNodeCard, getChildren, getCard,
        1, new Set(), 1, { titlesOnly: true }
      );

      expect(result).toContain("(17 chars)");
      expect(result).toContain("(13 chars)");
    });

    it("includes full metadata when combined with includeIds", () => {
      const result = compileNode(
        "node-a", getNodeCard, getChildren, getCard,
        1, new Set(), 1, { titlesOnly: true, includeIds: true }
      );

      expect(result).toContain("node:node-a");
      expect(result).toContain("depth:0");
      expect(result).toContain("chars:17");
      expect(result).toContain("node:node-b");
      expect(result).toContain("depth:1");
      expect(result).toContain("chars:13");
    });

    it("default (includeIds undefined) includes [node:X card:Y] short label and chars (260508)", () => {
      const result = compileNode(
        "node-a", getNodeCard, getChildren, getCard,
        1, new Set(), 1, { titlesOnly: true }
      );

      expect(result).toContain("Root [node:node-a card:card-a] (17 chars)");
      expect(result).toContain("├── Child [node:node-b card:card-b] (13 chars)");
      expect(result).not.toContain("<!--");
      expect(result).not.toContain("depth:");
    });

    it("includeIds=false explicitly omits IDs (minimal mode, legacy behavior)", () => {
      const result = compileNode(
        "node-a", getNodeCard, getChildren, getCard,
        1, new Set(), 1, { titlesOnly: true, includeIds: false }
      );

      expect(result).toContain("Root (17 chars)");
      expect(result).toContain("├── Child (13 chars)");
      expect(result).not.toContain("[node:");
      expect(result).not.toContain("<!--");
    });
  });

  describe("excludeNodes option", () => {
    const cards = new Map<string, Card>([
      ["card-a", makeCard({ id: "card-a", title: "Root" })],
      ["card-b", makeCard({ id: "card-b", title: "Child B" })],
      ["card-c", makeCard({ id: "card-c", title: "Grandchild C" })],
    ]);
    const nodes = new Map<string, TreeNode>([
      ["node-a", makeNode({ id: "node-a", card_id: "card-a" })],
      ["node-b", makeNode({ id: "node-b", card_id: "card-b", parent_node_id: "node-a", position: 100 })],
      ["node-c", makeNode({ id: "node-c", card_id: "card-c", parent_node_id: "node-b", position: 100 })],
    ]);
    const getChildren = (nid: string): TreeNode[] =>
      Array.from(nodes.values())
        .filter((n) => n.parent_node_id === nid)
        .sort((a, b) => a.position - b.position);
    const getNodeCard = (nid: string) => ({
      card_id: nodes.get(nid)!.card_id,
      is_symlink: nodes.get(nid)!.is_symlink,
    });
    const getCard = (cid: string) => cards.get(cid)!;

    it("excludes node and all descendants", () => {
      const result = compileNode(
        "node-a", getNodeCard, getChildren, getCard,
        Infinity, new Set(), 1, { excludeNodes: new Set(["node-b"]) }
      );

      expect(result).toContain("# Root");
      expect(result).not.toContain("Child B");
      expect(result).not.toContain("Grandchild C");
    });

    it("ignores non-existent node_ids", () => {
      const result = compileNode(
        "node-a", getNodeCard, getChildren, getCard,
        1, new Set(), 1, { excludeNodes: new Set(["non-existent-id"]) }
      );

      expect(result).toContain("# Root");
      expect(result).toContain("## Child B");
    });

    it("returns empty string when root node is excluded", () => {
      const result = compileNode(
        "node-a", getNodeCard, getChildren, getCard,
        1, new Set(), 1, { excludeNodes: new Set(["node-a"]) }
      );

      expect(result).toBe("");
    });
  });

  describe("maxChars option (unit level — via compileNode output length)", () => {
    it("maxChars=0 is ignored (no limit)", () => {
      const cards = new Map<string, Card>([
        ["card-a", makeCard({ id: "card-a", title: "Root", content: "Long content here" })],
      ]);
      const nodes = new Map<string, TreeNode>([
        ["node-a", makeNode({ id: "node-a", card_id: "card-a" })],
      ]);

      const result = compileNode(
        "node-a",
        (nid) => ({ card_id: nodes.get(nid)!.card_id, is_symlink: nodes.get(nid)!.is_symlink }),
        () => [],
        (cid) => cards.get(cid)!,
        0, new Set(), 1, { maxChars: 0 }
      );

      expect(result).toContain("Long content here");
    });
  });
});
