import { compileNode, type ResolvedRef } from "../../src/shared/bfs.js";
import type { Card, TreeNode } from "../../src/shared/types.js";
import { makeCard, makeNode } from "./bfs-fixtures.js";

describe("BFS compileNode", () => {
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
      const resolvedRefs = new Map<string, ResolvedRef>();
      const result = compileNode(
        "node-a", getNodeCard, getChildren, getCard, 0, new Set(), 1, { resolvedRefs }
      );
      expect(result).toMatch(/^# Root <!-- node:node-a card:card-a depth:0 created:[\d-]+ -->\nRoot content$/);
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
      const rootContentIdx = result.indexOf("Root content");
      const childHeaderIdx = result.indexOf("## Child");
      const childUnfurlIdx = result.indexOf("Child unfurl");
      expect(rootContentIdx).toBeLessThan(childHeaderIdx);
      expect(childUnfurlIdx).toBeGreaterThan(childHeaderIdx);
      expect(result).not.toContain("Root unfurl");
    });

    it("does not append unfurl when resolvedRefs is undefined (default behavior)", () => {
      const { getNodeCard, getChildren, getCard } = makeSetup();
      const result = compileNode(
        "node-a", getNodeCard, getChildren, getCard, 0, new Set(), 1, {}
      );
      expect(result).toMatch(/^# Root <!-- node:node-a card:card-a depth:0 created:[\d-]+ -->\nRoot content$/);
      expect(result).not.toContain("unfurl");
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
