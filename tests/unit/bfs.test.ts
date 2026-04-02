import { compileNode, type CompileOptions } from "../../src/shared/bfs.js";
import type { Card, TreeNode } from "../../src/shared/types.js";

function makeCard(overrides: Partial<Card> & { id: string; title: string }): Card {
  return {
    id: overrides.id,
    card_type: overrides.card_type ?? "knowledge",
    title: overrides.title,
    content: overrides.content ?? null,
    references: overrides.references ?? [],
    tags: overrides.tags ?? [],
    card_timestamp: overrides.card_timestamp ?? "2026-01-01T00:00:00Z",
    content_timestamp: overrides.content_timestamp ?? null,
    source_type: overrides.source_type ?? null,
    source_ref: overrides.source_ref ?? null,
    source_snapshot: overrides.source_snapshot ?? null,
    source_checksum: overrides.source_checksum ?? null,
    source_checked_at: overrides.source_checked_at ?? null,
    staleness: overrides.staleness ?? "unverified",
    version: overrides.version ?? 1,
    updated_at: overrides.updated_at ?? "2026-01-01T00:00:00Z",
    created_by: overrides.created_by ?? null,
    updated_by: overrides.updated_by ?? null,
  };
}

function makeNode(overrides: Partial<TreeNode> & { id: string; card_id: string }): TreeNode {
  return {
    id: overrides.id,
    card_id: overrides.card_id,
    parent_node_id: overrides.parent_node_id ?? null,
    position: overrides.position ?? 100,
    is_symlink: overrides.is_symlink ?? false,
    created_at: "2026-01-01T00:00:00Z",
  };
}

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
        () => [], // no children returned
        (cid) => cards.get(cid)!,
        0
      );

      expect(result).toBe("# Node A\nContent A");
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
      expect(result).not.toContain("Node C"); // depth=1 → not expanded
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

      expect(result).toBe("# Structure");
    });
  });

  describe("cycle detection", () => {
    it("detects A→B→A cycle and marks it with *(cycle)*", () => {
      const cards = new Map<string, Card>([
        ["card-a", makeCard({ id: "card-a", title: "Node A" })],
        ["card-b", makeCard({ id: "card-b", title: "Node B" })],
      ]);

      // Tree: node-a (card-a) → node-b (card-b) → node-a-symlink (card-a, symlink=true)
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
      // A→B→A→... should terminate
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

      // Should not hang
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
      // 7 levels deep
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

      expect(result).not.toMatch(/#######/); // no h7
      expect(result).toMatch(/#{6} Level 6/); // level 6 capped at h6
    });
  });

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

      // Root heading has full metadata
      expect(result).toContain("# Root <!-- node:node-a card:card-a created:2026-01-01 stale:stale source:url -->");
      // Child heading has node/card IDs and created (no stale, no source)
      expect(result).toContain("## Child <!-- node:node-b card:card-b created:2026-01-01 -->");
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

    it("omits HTML comment when options is undefined (default)", () => {
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

      expect(result).toBe("# Root");
      expect(result).not.toContain("<!--");
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

      // Cycle line should NOT have HTML comment
      const cycleLineMatch = result.match(/.*\*\(cycle\)\*.*/);
      expect(cycleLineMatch).not.toBeNull();
      expect(cycleLineMatch![0]).not.toContain("<!--");

      // But non-cycle headings should have comments
      expect(result).toContain("# Node A <!-- node:node-a card:card-a");
      expect(result).toContain("## Node B <!-- node:node-b card:card-b");
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

      expect(result).toContain("<!-- node:node-a card:card-a created:2026-01-01 -->");
      expect(result).not.toContain("stale:");
    });
  });
});
