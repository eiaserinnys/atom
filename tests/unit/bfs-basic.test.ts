import { compileNode } from "../../src/shared/bfs.js";
import type { Card, TreeNode } from "../../src/shared/types.js";
import { makeCard, makeNode } from "./bfs-fixtures.js";

describe("BFS compileNode", () => {
  describe("depth=0", () => {
    it("returns only the current node, no children", () => {
      const cards = new Map<string, Card>([
        ["card-a", makeCard({ id: "card-a", title: "Node A", content: "Content A" })],
        ["card-b", makeCard({ id: "card-b", title: "Node B" })],
      ]);
      const nodes = new Map<string, TreeNode>([
        ["node-a", makeNode({ id: "node-a", card_id: "card-a" })],
        ["node-b", makeNode({ id: "node-b", card_id: "card-b", parent_node_id: "node-a" })],
      ]);

      const result = compileNode(
        "node-a",
        (nid) => ({ card_id: nodes.get(nid)!.card_id, is_symlink: nodes.get(nid)!.is_symlink }),
        () => [],
        (cid) => cards.get(cid)!,
        0
      );

      expect(result).toMatch(/^# Node A <!-- node:node-a card:card-a depth:0 created:[\d-]+ -->\nContent A$/);
      expect(result).not.toContain("Node B");
    });
  });

  describe("depth=1", () => {
    it("returns current node and direct children", () => {
      const cards = new Map<string, Card>([
        ["card-a", makeCard({ id: "card-a", title: "Node A" })],
        ["card-b", makeCard({ id: "card-b", title: "Node B" })],
        ["card-c", makeCard({ id: "card-c", title: "Node C" })],
      ]);
      const nodes = new Map<string, TreeNode>([
        ["node-a", makeNode({ id: "node-a", card_id: "card-a" })],
        ["node-b", makeNode({ id: "node-b", card_id: "card-b", parent_node_id: "node-a", position: 100 })],
        ["node-c", makeNode({ id: "node-c", card_id: "card-c", parent_node_id: "node-b" })],
      ]);

      const getChildren = (nid: string): TreeNode[] =>
        Array.from(nodes.values())
          .filter((n) => n.parent_node_id === nid)
          .sort((a, b) => a.position - b.position);

      const result = compileNode(
        "node-a",
        (nid) => ({ card_id: nodes.get(nid)!.card_id, is_symlink: nodes.get(nid)!.is_symlink }),
        getChildren,
        (cid) => cards.get(cid)!,
        1
      );

      expect(result).toContain("# Node A");
      expect(result).toContain("## Node B");
      expect(result).not.toContain("Node C");
    });
  });

  describe("structure card with null content", () => {
    it("compiles without error when content is null", () => {
      const cards = new Map<string, Card>([
        ["card-a", makeCard({ id: "card-a", title: "Structure", card_type: "structure", content: null })],
      ]);
      const nodes = new Map<string, TreeNode>([
        ["node-a", makeNode({ id: "node-a", card_id: "card-a" })],
      ]);

      const result = compileNode(
        "node-a",
        (nid) => ({ card_id: nodes.get(nid)!.card_id, is_symlink: nodes.get(nid)!.is_symlink }),
        () => [],
        (cid) => cards.get(cid)!,
        2
      );

      expect(result).toMatch(/^# Structure <!-- node:node-a card:card-a depth:0 created:[\d-]+ -->$/);
    });
  });

  describe("cycle detection", () => {
    it("detects A→B→A cycle and marks it with *(cycle)*", () => {
      const cards = new Map<string, Card>([
        ["card-a", makeCard({ id: "card-a", title: "Node A" })],
        ["card-b", makeCard({ id: "card-b", title: "Node B" })],
      ]);

      const nodeMap = new Map<string, TreeNode>([
        ["node-a", makeNode({ id: "node-a", card_id: "card-a" })],
        ["node-b", makeNode({ id: "node-b", card_id: "card-b", parent_node_id: "node-a" })],
        ["node-cycle", makeNode({ id: "node-cycle", card_id: "card-a", parent_node_id: "node-b", is_symlink: true })],
      ]);

      const getChildren = (nid: string): TreeNode[] =>
        Array.from(nodeMap.values())
          .filter((n) => n.parent_node_id === nid)
          .sort((a, b) => a.position - b.position);

      const result = compileNode(
        "node-a",
        (nid) => ({ card_id: nodeMap.get(nid)!.card_id, is_symlink: nodeMap.get(nid)!.is_symlink }),
        getChildren,
        (cid) => cards.get(cid)!,
        Infinity
      );

      expect(result).toContain("# Node A");
      expect(result).toContain("## Node B");
      expect(result).toContain("*(cycle)*");
      expect(result).toContain("Node A *(cycle)*");
    });

    it("safely terminates and does not infinite-loop", () => {
      const cards = new Map<string, Card>([
        ["card-a", makeCard({ id: "card-a", title: "A" })],
        ["card-b", makeCard({ id: "card-b", title: "B" })],
      ]);
      const nodes = new Map<string, TreeNode>([
        ["n-a", makeNode({ id: "n-a", card_id: "card-a" })],
        ["n-b", makeNode({ id: "n-b", card_id: "card-b", parent_node_id: "n-a" })],
        ["n-a2", makeNode({ id: "n-a2", card_id: "card-a", parent_node_id: "n-b", is_symlink: true })],
      ]);

      const getChildren = (nid: string): TreeNode[] =>
        Array.from(nodes.values()).filter((n) => n.parent_node_id === nid);

      const result = compileNode(
        "n-a",
        (nid) => ({ card_id: nodes.get(nid)!.card_id, is_symlink: nodes.get(nid)!.is_symlink }),
        getChildren,
        (cid) => cards.get(cid)!,
        Number.MAX_SAFE_INTEGER
      );

      expect(result).toContain("*(cycle)*");
    });
  });

  describe("heading level capping", () => {
    it("caps heading level at h6", () => {
      const depth = 7;
      const cardIds = Array.from({ length: depth }, (_, i) => `card-${i}`);
      const nodeIds = Array.from({ length: depth }, (_, i) => `node-${i}`);

      const cards = new Map<string, Card>(
        cardIds.map((cid, i) => [cid, makeCard({ id: cid, title: `Level ${i}` })])
      );
      const nodes = new Map<string, TreeNode>(
        nodeIds.map((nid, i) =>
          [nid, makeNode({ id: nid, card_id: cardIds[i]!, parent_node_id: i > 0 ? nodeIds[i - 1]! : null })]
        )
      );

      const getChildren = (nid: string): TreeNode[] =>
        Array.from(nodes.values()).filter((n) => n.parent_node_id === nid);

      const result = compileNode(
        "node-0",
        (nid) => ({ card_id: nodes.get(nid)!.card_id, is_symlink: nodes.get(nid)!.is_symlink }),
        getChildren,
        (cid) => cards.get(cid)!,
        depth
      );

      expect(result).not.toMatch(/#######/);
      expect(result).toMatch(/#{6} Level 6/);
    });
  });
});
