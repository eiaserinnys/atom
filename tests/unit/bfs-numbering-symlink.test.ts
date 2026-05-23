import { compileNode } from "../../src/shared/bfs.js";
import type { Card, TreeNode } from "../../src/shared/types.js";
import { makeCard, makeNode } from "./bfs-fixtures.js";

describe("BFS compileNode", () => {
  describe("numbering option", () => {
    const cards = new Map<string, Card>([
      ["card-root", makeCard({ id: "card-root", title: "Project" })],
      ["card-a", makeCard({ id: "card-a", title: "Alpha", content: "Alpha content" })],
      ["card-b", makeCard({ id: "card-b", title: "Beta" })],
      ["card-a1", makeCard({ id: "card-a1", title: "Alpha Child 1" })],
      ["card-a2", makeCard({ id: "card-a2", title: "Alpha Child 2" })],
      ["card-a1x", makeCard({ id: "card-a1x", title: "Deep Leaf" })],
    ]);
    const nodes = new Map<string, TreeNode>([
      ["n-root", makeNode({ id: "n-root", card_id: "card-root" })],
      ["n-a", makeNode({ id: "n-a", card_id: "card-a", parent_node_id: "n-root", position: 100 })],
      ["n-b", makeNode({ id: "n-b", card_id: "card-b", parent_node_id: "n-root", position: 200 })],
      ["n-a1", makeNode({ id: "n-a1", card_id: "card-a1", parent_node_id: "n-a", position: 100 })],
      ["n-a2", makeNode({ id: "n-a2", card_id: "card-a2", parent_node_id: "n-a", position: 200 })],
      ["n-a1x", makeNode({ id: "n-a1x", card_id: "card-a1x", parent_node_id: "n-a1", position: 100 })],
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

    it("prepends hierarchical numbers in full markdown mode", () => {
      const result = compileNode(
        "n-root", getNodeCard, getChildren, getCard,
        3, new Set(), 1, { numbering: true }
      );

      expect(result).toContain("# Project");
      expect(result).not.toContain("# 1 Project");
      expect(result).toContain("## 1 Alpha");
      expect(result).toContain("## 2 Beta");
      expect(result).toContain("### 1.1 Alpha Child 1");
      expect(result).toContain("### 1.2 Alpha Child 2");
      expect(result).toContain("#### 1.1.1 Deep Leaf");
    });

    it("prepends hierarchical numbers in titlesOnly mode", () => {
      const result = compileNode(
        "n-root", getNodeCard, getChildren, getCard,
        3, new Set(), 1, { numbering: true, titlesOnly: true }
      );

      expect(result).toContain("Project");
      expect(result).toContain("├── 1 Alpha");
      expect(result).toContain("├── 2 Beta");
      expect(result).toContain("├── 1.1 Alpha Child 1");
      expect(result).toContain("├── 1.2 Alpha Child 2");
      expect(result).toContain("├── 1.1.1 Deep Leaf");
    });

    it("does not add numbers when numbering is false or absent", () => {
      const result = compileNode(
        "n-root", getNodeCard, getChildren, getCard,
        2, new Set(), 1, {}
      );

      expect(result).toContain("## Alpha");
      expect(result).not.toMatch(/## \d+ Alpha/);
    });

    it("works with includeIds", () => {
      const result = compileNode(
        "n-root", getNodeCard, getChildren, getCard,
        1, new Set(), 1, { numbering: true, includeIds: true }
      );

      expect(result).toContain("## 1 Alpha <!-- node:n-a");
      expect(result).toContain("## 2 Beta <!-- node:n-b");
    });

    it("preserves numbering on cycle nodes", () => {
      const cycleCards = new Map<string, Card>([
        ["card-x", makeCard({ id: "card-x", title: "X" })],
        ["card-y", makeCard({ id: "card-y", title: "Y" })],
      ]);
      const cycleNodes = new Map<string, TreeNode>([
        ["nx", makeNode({ id: "nx", card_id: "card-x" })],
        ["ny", makeNode({ id: "ny", card_id: "card-y", parent_node_id: "nx" })],
        ["nx2", makeNode({ id: "nx2", card_id: "card-x", parent_node_id: "ny", is_symlink: true })],
      ]);
      const getCycleChildren = (nid: string): TreeNode[] =>
        Array.from(cycleNodes.values()).filter((n) => n.parent_node_id === nid);

      const result = compileNode(
        "nx",
        (nid) => ({ card_id: cycleNodes.get(nid)!.card_id, is_symlink: cycleNodes.get(nid)!.is_symlink }),
        getCycleChildren,
        (cid) => cycleCards.get(cid)!,
        Infinity, new Set(), 1, { numbering: true }
      );

      expect(result).toContain("### 1.1 X *(cycle)*");
    });
  });

  describe("symlink marker", () => {
    it("symlink marker in titles_only mode", () => {
      const cards = new Map<string, Card>([
        ["card-a", makeCard({ id: "card-a", title: "Root", content: "Root content" })],
        ["card-b", makeCard({ id: "card-b", title: "Symlink Child", content: "Child content" })],
      ]);
      const nodes = new Map<string, TreeNode>([
        ["node-a", makeNode({ id: "node-a", card_id: "card-a" })],
        ["node-b", makeNode({ id: "node-b", card_id: "card-b", parent_node_id: "node-a", is_symlink: true })],
      ]);
      const getChildren = (nid: string): TreeNode[] =>
        Array.from(nodes.values()).filter((n) => n.parent_node_id === nid);
      const getNodeCard = (nid: string) => ({ card_id: nodes.get(nid)!.card_id, is_symlink: nodes.get(nid)!.is_symlink });

      const result = compileNode(
        "node-a", getNodeCard, getChildren, (cid) => cards.get(cid)!,
        1, new Set(), 1, { titlesOnly: true }
      );

      expect(result).toContain("├── ~ Symlink Child");
      expect(result).not.toContain("├── Symlink Child (");
    });

    it("symlink marker in full markdown mode", () => {
      const cards = new Map<string, Card>([
        ["card-a", makeCard({ id: "card-a", title: "Root" })],
        ["card-b", makeCard({ id: "card-b", title: "Symlink Child" })],
      ]);
      const nodes = new Map<string, TreeNode>([
        ["node-a", makeNode({ id: "node-a", card_id: "card-a" })],
        ["node-b", makeNode({ id: "node-b", card_id: "card-b", parent_node_id: "node-a", is_symlink: true })],
      ]);
      const getChildren = (nid: string): TreeNode[] =>
        Array.from(nodes.values()).filter((n) => n.parent_node_id === nid);
      const getNodeCard = (nid: string) => ({ card_id: nodes.get(nid)!.card_id, is_symlink: nodes.get(nid)!.is_symlink });

      const result = compileNode(
        "node-a", getNodeCard, getChildren, (cid) => cards.get(cid)!,
        1, new Set(), 1, {}
      );

      expect(result).toContain("## ~ Symlink Child");
      expect(result).not.toContain("## Symlink Child");
    });

    it("symlink:true in include_ids HTML comment", () => {
      const cards = new Map<string, Card>([
        ["card-a", makeCard({ id: "card-a", title: "Root" })],
        ["card-b", makeCard({ id: "card-b", title: "Symlink Child" })],
      ]);
      const nodes = new Map<string, TreeNode>([
        ["node-a", makeNode({ id: "node-a", card_id: "card-a" })],
        ["node-b", makeNode({ id: "node-b", card_id: "card-b", parent_node_id: "node-a", is_symlink: true })],
      ]);
      const getChildren = (nid: string): TreeNode[] =>
        Array.from(nodes.values()).filter((n) => n.parent_node_id === nid);
      const getNodeCard = (nid: string) => ({ card_id: nodes.get(nid)!.card_id, is_symlink: nodes.get(nid)!.is_symlink });

      const result = compileNode(
        "node-a", getNodeCard, getChildren, (cid) => cards.get(cid)!,
        1, new Set(), 1, { includeIds: true }
      );

      expect(result).toContain("## ~ Symlink Child <!-- node:node-b card:card-b depth:1 created:2026-01-01 symlink:true -->");
      expect(result).toContain("# Root <!-- node:node-a card:card-a depth:0 created:2026-01-01 -->");
      expect(result).not.toMatch(/node:node-a.*symlink:true/);
    });

    it("non-symlink has no marker", () => {
      const cards = new Map<string, Card>([
        ["card-a", makeCard({ id: "card-a", title: "Regular Node" })],
      ]);
      const nodes = new Map<string, TreeNode>([
        ["node-a", makeNode({ id: "node-a", card_id: "card-a", is_symlink: false })],
      ]);
      const getNodeCard = (nid: string) => ({ card_id: nodes.get(nid)!.card_id, is_symlink: nodes.get(nid)!.is_symlink });

      const result = compileNode(
        "node-a", getNodeCard, () => [], (cid) => cards.get(cid)!,
        0, new Set(), 1, {}
      );

      expect(result).toContain("# Regular Node <!-- node:node-a card:card-a depth:0 created:");
      expect(result).not.toContain("~");
      expect(result).not.toContain("symlink:true");
    });

    it("titles_only default: symlink node carries [node:X card:Y] with canonical card_id", () => {
      const cards = new Map<string, Card>([
        ["card-a", makeCard({ id: "card-a", title: "Root", content: "R" })],
        ["card-b", makeCard({ id: "card-b", title: "Sym", content: "S" })],
      ]);
      const nodes = new Map<string, TreeNode>([
        ["node-a", makeNode({ id: "node-a", card_id: "card-a" })],
        ["node-b", makeNode({ id: "node-b", card_id: "card-b", parent_node_id: "node-a", is_symlink: true })],
      ]);
      const getChildren = (nid: string): TreeNode[] =>
        Array.from(nodes.values()).filter((n) => n.parent_node_id === nid);
      const getNodeCard = (nid: string) => ({ card_id: nodes.get(nid)!.card_id, is_symlink: nodes.get(nid)!.is_symlink });

      const result = compileNode(
        "node-a", getNodeCard, getChildren, (cid) => cards.get(cid)!,
        1, new Set(), 1, { titlesOnly: true }
      );

      expect(result).toContain("├── ~ Sym [node:node-b card:card-b] (1 chars)");
    });
  });
});
