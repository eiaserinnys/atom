import { compileNode, type CompileOptions, type ResolvedRef } from "../../src/shared/bfs.js";
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
    journal_limit: overrides.journal_limit ?? null,
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

      // Root heading has full metadata (depth:0 for root)
      expect(result).toContain("# Root <!-- node:node-a card:card-a depth:0 created:2026-01-01 stale:stale source:url -->");
      // Child heading has node/card IDs and created (depth:1, no stale, no source)
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
      expect(result).not.toContain("#"); // no markdown headings
      expect(result).toContain("Root");
      expect(result).toContain("├── Child");
      expect(result).toContain("├── Grandchild");
    });

    it("includes chars metadata by default", () => {
      const result = compileNode(
        "node-a", getNodeCard, getChildren, getCard,
        1, new Set(), 1, { titlesOnly: true }
      );

      expect(result).toContain("(17 chars)"); // "Root content here".length = 17
      expect(result).toContain("(13 chars)"); // "Child content".length = 13
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

      expect(result).toContain("depth:0"); // root
      expect(result).toContain("depth:1"); // child
      expect(result).toContain("depth:2"); // grandchild
    });

    it("h6-capped nodes still report correct depth in metadata", () => {
      // 8 levels deep
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

      // Heading capped at h6 but depth metadata shows 7
      expect(result).toContain("depth:7");
      expect(result).not.toMatch(/#######/); // no h7
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

      // maxChars is applied at service layer, but the option should pass through cleanly
      const result = compileNode(
        "node-a",
        (nid) => ({ card_id: nodes.get(nid)!.card_id, is_symlink: nodes.get(nid)!.is_symlink }),
        () => [],
        (cid) => cards.get(cid)!,
        0, new Set(), 1, { maxChars: 0 }
      );

      expect(result).toContain("Long content here"); // not truncated
    });
  });

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

      // Root has no number
      expect(result).toContain("# Project");
      expect(result).not.toContain("# 1 Project");
      // Direct children: 1, 2
      expect(result).toContain("## 1 Alpha");
      expect(result).toContain("## 2 Beta");
      // Grandchildren: 1.1, 1.2
      expect(result).toContain("### 1.1 Alpha Child 1");
      expect(result).toContain("### 1.2 Alpha Child 2");
      // Great-grandchild: 1.1.1
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
      // Root is not a symlink — comment present but no symlink:true
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

      expect(result).toBe("# Regular Node");
      expect(result).not.toContain("~");
    });
  });

  describe("resolvedRefs option", () => {
    function makeSetup() {
      const cards = new Map<string, Card>([
        ["card-a", makeCard({ id: "card-a", title: "Root", content: "Root content" })],
        ["card-b", makeCard({ id: "card-b", title: "Child", content: "Child content" })],
      ]);
      const nodes = new Map<string, TreeNode>([
        ["node-a", makeNode({ id: "node-a", card_id: "card-a" })],
        ["node-b", makeNode({ id: "node-b", card_id: "card-b", parent_node_id: "node-a" })],
      ]);
      const getNodeCard = (nid: string) => ({ card_id: nodes.get(nid)!.card_id, is_symlink: nodes.get(nid)!.is_symlink });
      const getChildren = (nid: string): TreeNode[] =>
        Array.from(nodes.values()).filter((n) => n.parent_node_id === nid).sort((a, b) => a.position - b.position);
      const getCard = (cid: string): Card => cards.get(cid)!;
      return { cards, nodes, getNodeCard, getChildren, getCard };
    }

    it("appends unfurl text when ok=true for a card", () => {
      const { getNodeCard, getChildren, getCard } = makeSetup();
      const resolvedRefs = new Map<string, ResolvedRef>([
        ["card-a", {
          ok: true,
          result: { text: "Unfurled content", snapshot: "{}", unfurlData: null },
          sourceType: "trello",
        }],
      ]);
      const result = compileNode(
        "node-a", getNodeCard, getChildren, getCard, 0, new Set(), 1, { resolvedRefs }
      );
      expect(result).toContain("Root content");
      expect(result).toContain("Unfurled content");
    });

    it("appends unfurl failed comment when ok=false for a card", () => {
      const { getNodeCard, getChildren, getCard } = makeSetup();
      const resolvedRefs = new Map<string, ResolvedRef>([
        ["card-a", {
          ok: false,
          error: "Network error",
          sourceType: "trello",
        }],
      ]);
      const result = compileNode(
        "node-a", getNodeCard, getChildren, getCard, 0, new Set(), 1, { resolvedRefs }
      );
      expect(result).toContain("<!-- unfurl failed: trello -->");
    });

    it("does not append anything when card not in resolvedRefs", () => {
      const { getNodeCard, getChildren, getCard } = makeSetup();
      const resolvedRefs = new Map<string, ResolvedRef>(); // empty
      const result = compileNode(
        "node-a", getNodeCard, getChildren, getCard, 0, new Set(), 1, { resolvedRefs }
      );
      expect(result).toBe("# Root\nRoot content");
      expect(result).not.toContain("unfurl");
    });

    it("applies resolvedRefs only to matched cards in a multi-node tree", () => {
      const { getNodeCard, getChildren, getCard } = makeSetup();
      const resolvedRefs = new Map<string, ResolvedRef>([
        ["card-b", {
          ok: true,
          result: { text: "Child unfurl", snapshot: "{}", unfurlData: null },
          sourceType: "trello",
        }],
      ]);
      const result = compileNode(
        "node-a", getNodeCard, getChildren, getCard, 1, new Set(), 1, { resolvedRefs }
      );
      // card-a (Root) should NOT have unfurl appended directly after its own content
      // The output order: "# Root\nRoot content\n## Child\nChild content\nChild unfurl"
      // Root content should appear but NOT followed immediately by "Child unfurl"
      const rootContentIdx = result.indexOf("Root content");
      const childHeaderIdx = result.indexOf("## Child");
      const childUnfurlIdx = result.indexOf("Child unfurl");
      // Root content comes before child header
      expect(rootContentIdx).toBeLessThan(childHeaderIdx);
      // Child unfurl comes after child header
      expect(childUnfurlIdx).toBeGreaterThan(childHeaderIdx);
      // No "Root unfurl" anywhere
      expect(result).not.toContain("Root unfurl");
    });

    it("does not append unfurl when resolvedRefs is undefined (default behavior)", () => {
      const { getNodeCard, getChildren, getCard } = makeSetup();
      const result = compileNode(
        "node-a", getNodeCard, getChildren, getCard, 0, new Set(), 1, {}
      );
      expect(result).toBe("# Root\nRoot content");
    });
  });

  describe("limit option", () => {
    it("limits direct children to the latest n by card_timestamp", () => {
      const cards = new Map<string, Card>([
        ["card-root", makeCard({ id: "card-root", title: "Root" })],
        ["card-a", makeCard({ id: "card-a", title: "Child A", card_timestamp: "2026-01-01T00:00:00Z" })],
        ["card-b", makeCard({ id: "card-b", title: "Child B", card_timestamp: "2026-01-03T00:00:00Z" })],
        ["card-c", makeCard({ id: "card-c", title: "Child C", card_timestamp: "2026-01-02T00:00:00Z" })],
      ]);
      const nodes = new Map<string, TreeNode>([
        ["node-root", makeNode({ id: "node-root", card_id: "card-root" })],
        ["node-a", makeNode({ id: "node-a", card_id: "card-a", parent_node_id: "node-root", position: 100 })],
        ["node-b", makeNode({ id: "node-b", card_id: "card-b", parent_node_id: "node-root", position: 200 })],
        ["node-c", makeNode({ id: "node-c", card_id: "card-c", parent_node_id: "node-root", position: 300 })],
      ]);

      const getChildren = (nid: string): TreeNode[] =>
        Array.from(nodes.values())
          .filter((n) => n.parent_node_id === nid)
          .sort((a, b) => a.position - b.position);

      // limit=2 → should include the 2 latest: B (Jan 3) and C (Jan 2), excluding A (Jan 1)
      const result = compileNode(
        "node-root",
        (nid) => ({ card_id: nodes.get(nid)!.card_id, is_symlink: nodes.get(nid)!.is_symlink }),
        getChildren,
        (cid) => cards.get(cid)!,
        1,
        new Set(),
        1,
        { limit: 2 }
      );

      expect(result).toContain("# Root");
      expect(result).toContain("## Child B");
      expect(result).toContain("## Child C");
      expect(result).not.toContain("Child A");
    });

    it("does not apply limit to deeper levels (depth > 1)", () => {
      const cards = new Map<string, Card>([
        ["card-root", makeCard({ id: "card-root", title: "Root" })],
        ["card-a", makeCard({ id: "card-a", title: "Child A", card_timestamp: "2026-01-01T00:00:00Z" })],
        ["card-b", makeCard({ id: "card-b", title: "Child B", card_timestamp: "2026-01-03T00:00:00Z" })],
        // grandchildren under child-a
        ["card-ga1", makeCard({ id: "card-ga1", title: "Grandchild A1", card_timestamp: "2026-01-04T00:00:00Z" })],
        ["card-ga2", makeCard({ id: "card-ga2", title: "Grandchild A2", card_timestamp: "2026-01-05T00:00:00Z" })],
        ["card-ga3", makeCard({ id: "card-ga3", title: "Grandchild A3", card_timestamp: "2026-01-06T00:00:00Z" })],
      ]);
      const nodes = new Map<string, TreeNode>([
        ["node-root", makeNode({ id: "node-root", card_id: "card-root" })],
        ["node-a", makeNode({ id: "node-a", card_id: "card-a", parent_node_id: "node-root", position: 100 })],
        ["node-b", makeNode({ id: "node-b", card_id: "card-b", parent_node_id: "node-root", position: 200 })],
        ["node-ga1", makeNode({ id: "node-ga1", card_id: "card-ga1", parent_node_id: "node-a", position: 100 })],
        ["node-ga2", makeNode({ id: "node-ga2", card_id: "card-ga2", parent_node_id: "node-a", position: 200 })],
        ["node-ga3", makeNode({ id: "node-ga3", card_id: "card-ga3", parent_node_id: "node-a", position: 300 })],
      ]);

      const getChildren = (nid: string): TreeNode[] =>
        Array.from(nodes.values())
          .filter((n) => n.parent_node_id === nid)
          .sort((a, b) => a.position - b.position);

      // limit=1 → only 1 direct child (B, latest). But B has no grandchildren.
      // A is excluded by limit, so its grandchildren are not visited at all.
      const result = compileNode(
        "node-root",
        (nid) => ({ card_id: nodes.get(nid)!.card_id, is_symlink: nodes.get(nid)!.is_symlink }),
        getChildren,
        (cid) => cards.get(cid)!,
        2,
        new Set(),
        1,
        { limit: 1 }
      );

      expect(result).toContain("# Root");
      expect(result).toContain("## Child B");
      expect(result).not.toContain("Child A");
      expect(result).not.toContain("Grandchild");
    });

    it("returns all children when limit exceeds child count", () => {
      const cards = new Map<string, Card>([
        ["card-root", makeCard({ id: "card-root", title: "Root" })],
        ["card-a", makeCard({ id: "card-a", title: "Child A", card_timestamp: "2026-01-01T00:00:00Z" })],
        ["card-b", makeCard({ id: "card-b", title: "Child B", card_timestamp: "2026-01-02T00:00:00Z" })],
      ]);
      const nodes = new Map<string, TreeNode>([
        ["node-root", makeNode({ id: "node-root", card_id: "card-root" })],
        ["node-a", makeNode({ id: "node-a", card_id: "card-a", parent_node_id: "node-root", position: 100 })],
        ["node-b", makeNode({ id: "node-b", card_id: "card-b", parent_node_id: "node-root", position: 200 })],
      ]);

      const getChildren = (nid: string): TreeNode[] =>
        Array.from(nodes.values())
          .filter((n) => n.parent_node_id === nid)
          .sort((a, b) => a.position - b.position);

      // limit=10, only 2 children — all should be included
      const result = compileNode(
        "node-root",
        (nid) => ({ card_id: nodes.get(nid)!.card_id, is_symlink: nodes.get(nid)!.is_symlink }),
        getChildren,
        (cid) => cards.get(cid)!,
        1,
        new Set(),
        1,
        { limit: 10 }
      );

      expect(result).toContain("## Child A");
      expect(result).toContain("## Child B");
    });
  });
});
