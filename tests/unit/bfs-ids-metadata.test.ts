import { compileNode } from "../../src/shared/bfs.js";
import type { Card, TreeNode } from "../../src/shared/types.js";
import { makeCard, makeNode } from "./bfs-fixtures.js";

describe("BFS compileNode", () => {
  describe("includeIds option", () => {
    it("appends HTML comment with node/card IDs and metadata when includeIds=true", () => {
      const cards = new Map<string, Card>([
        ["card-a", makeCard({
          id: "card-a",
          title: "Root",
          content: "Root content",
          source_type: "url",
          staleness: "stale",
        })],
        ["card-b", makeCard({ id: "card-b", title: "Child" })],
      ]);
      const nodes = new Map<string, TreeNode>([
        ["node-a", makeNode({ id: "node-a", card_id: "card-a" })],
        ["node-b", makeNode({ id: "node-b", card_id: "card-b", parent_node_id: "node-a" })],
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
        1,
        new Set(),
        1,
        { includeIds: true }
      );

      expect(result).toContain("# Root <!-- node:node-a card:card-a depth:0 created:2026-01-01 stale:stale source:url -->");
      expect(result).toContain("## Child <!-- node:node-b card:card-b depth:1 created:2026-01-01 -->");
    });

    it("omits HTML comment when includeIds is false", () => {
      const cards = new Map<string, Card>([
        ["card-a", makeCard({ id: "card-a", title: "Root" })],
      ]);
      const nodes = new Map<string, TreeNode>([
        ["node-a", makeNode({ id: "node-a", card_id: "card-a" })],
      ]);

      const result = compileNode(
        "node-a",
        (nid) => ({ card_id: nodes.get(nid)!.card_id, is_symlink: nodes.get(nid)!.is_symlink }),
        () => [],
        (cid) => cards.get(cid)!,
        0,
        new Set(),
        1,
        { includeIds: false }
      );

      expect(result).toBe("# Root");
      expect(result).not.toContain("<!--");
    });

    it("appends HTML comment with node/card IDs by default (options undefined)", () => {
      const cards = new Map<string, Card>([
        ["card-a", makeCard({ id: "card-a", title: "Root" })],
      ]);
      const nodes = new Map<string, TreeNode>([
        ["node-a", makeNode({ id: "node-a", card_id: "card-a" })],
      ]);

      const result = compileNode(
        "node-a",
        (nid) => ({ card_id: nodes.get(nid)!.card_id, is_symlink: nodes.get(nid)!.is_symlink }),
        () => [],
        (cid) => cards.get(cid)!,
        0
      );

      expect(result).toContain("# Root <!-- node:node-a card:card-a depth:0 created:2026-01-01 -->");
    });

    it("heading mode: includeIds=false explicitly omits HTML comment (minimal, legacy)", () => {
      const cards = new Map<string, Card>([
        ["card-a", makeCard({ id: "card-a", title: "Root" })],
      ]);
      const nodes = new Map<string, TreeNode>([
        ["node-a", makeNode({ id: "node-a", card_id: "card-a" })],
      ]);

      const result = compileNode(
        "node-a",
        (nid) => ({ card_id: nodes.get(nid)!.card_id, is_symlink: nodes.get(nid)!.is_symlink }),
        () => [],
        (cid) => cards.get(cid)!,
        0,
        new Set(),
        1,
        { includeIds: false }
      );

      expect(result).toBe("# Root");
      expect(result).not.toContain("<!--");
    });

    it("heading mode: default outputs HTML comment with node/card IDs and depth (multi-node)", () => {
      const cards = new Map<string, Card>([
        ["card-a", makeCard({ id: "card-a", title: "Root" })],
        ["card-b", makeCard({ id: "card-b", title: "Child" })],
      ]);
      const nodes = new Map<string, TreeNode>([
        ["node-a", makeNode({ id: "node-a", card_id: "card-a" })],
        ["node-b", makeNode({ id: "node-b", card_id: "card-b", parent_node_id: "node-a" })],
      ]);
      const getChildren = (nid: string): TreeNode[] =>
        Array.from(nodes.values()).filter((n) => n.parent_node_id === nid);

      const result = compileNode(
        "node-a",
        (nid) => ({ card_id: nodes.get(nid)!.card_id, is_symlink: nodes.get(nid)!.is_symlink }),
        getChildren,
        (cid) => cards.get(cid)!,
        1
      );

      expect(result).toContain("# Root <!-- node:node-a card:card-a depth:0 created:2026-01-01 -->");
      expect(result).toContain("## Child <!-- node:node-b card:card-b depth:1 created:2026-01-01 -->");
    });

    it("does not add comment to cycle nodes even with includeIds=true", () => {
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
        Infinity,
        new Set(),
        1,
        { includeIds: true }
      );

      const cycleLineMatch = result.match(/.*\*\(cycle\)\*.*/);
      expect(cycleLineMatch).not.toBeNull();
      expect(cycleLineMatch![0]).not.toContain("<!--");
      expect(result).toContain("# Node A <!-- node:node-a card:card-a depth:0");
      expect(result).toContain("## Node B <!-- node:node-b card:card-b depth:1");
    });

    it("omits stale field when staleness is fresh or unverified", () => {
      const cards = new Map<string, Card>([
        ["card-a", makeCard({ id: "card-a", title: "Fresh", staleness: "fresh" })],
      ]);
      const nodes = new Map<string, TreeNode>([
        ["node-a", makeNode({ id: "node-a", card_id: "card-a" })],
      ]);

      const result = compileNode(
        "node-a",
        (nid) => ({ card_id: nodes.get(nid)!.card_id, is_symlink: nodes.get(nid)!.is_symlink }),
        () => [],
        (cid) => cards.get(cid)!,
        0,
        new Set(),
        1,
        { includeIds: true }
      );

      expect(result).toContain("<!-- node:node-a card:card-a depth:0 created:2026-01-01 -->");
      expect(result).not.toContain("stale:");
    });
  });

  describe("depth in metadata", () => {
    it("includes depth:N in includeIds metadata", () => {
      const cards = new Map<string, Card>([
        ["card-a", makeCard({ id: "card-a", title: "Root" })],
        ["card-b", makeCard({ id: "card-b", title: "Child" })],
        ["card-c", makeCard({ id: "card-c", title: "Grandchild" })],
      ]);
      const nodes = new Map<string, TreeNode>([
        ["node-a", makeNode({ id: "node-a", card_id: "card-a" })],
        ["node-b", makeNode({ id: "node-b", card_id: "card-b", parent_node_id: "node-a" })],
        ["node-c", makeNode({ id: "node-c", card_id: "card-c", parent_node_id: "node-b" })],
      ]);
      const getChildren = (nid: string): TreeNode[] =>
        Array.from(nodes.values()).filter((n) => n.parent_node_id === nid);

      const result = compileNode(
        "node-a",
        (nid) => ({ card_id: nodes.get(nid)!.card_id, is_symlink: nodes.get(nid)!.is_symlink }),
        getChildren,
        (cid) => cards.get(cid)!,
        2, new Set(), 1, { includeIds: true }
      );

      expect(result).toContain("depth:0");
      expect(result).toContain("depth:1");
      expect(result).toContain("depth:2");
    });

    it("h6-capped nodes still report correct depth in metadata", () => {
      const levels = 8;
      const cardIds = Array.from({ length: levels }, (_, i) => `card-${i}`);
      const nodeIds = Array.from({ length: levels }, (_, i) => `node-${i}`);
      const cards = new Map<string, Card>(
        cardIds.map((cid, i) => [cid, makeCard({ id: cid, title: `L${i}` })])
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
        levels, new Set(), 1, { includeIds: true }
      );

      expect(result).toContain("depth:7");
      expect(result).not.toMatch(/#######/);
    });
  });
});
