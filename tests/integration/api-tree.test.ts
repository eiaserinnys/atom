/**
 * Integration tests split from api.test.ts.
 *
 * Requires TEST_DATABASE_URL to point to a test PostgreSQL database.
 */

import { setupIntegrationTestDb } from "./integration-harness.js";
import * as cardService from "../../src/services/card.service.js";
import * as treeService from "../../src/services/tree.service.js";

setupIntegrationTestDb();

describe("Tree operations", () => {
  it("creates root node when parent_node_id is omitted", async () => {
    const { node_id } = await cardService.createCard({
      card_type: "structure",
      title: "Root Node",
    });

    const roots = await treeService.listChildren(null);
    expect(roots.some((n) => n.id === node_id)).toBe(true);
  });

  it("creates a child node under a parent", async () => {
    const { node_id: rootId } = await cardService.createCard({
      card_type: "structure",
      title: "Parent",
    });

    const { node_id: childId } = await cardService.createCard({
      card_type: "knowledge",
      title: "Child",
      parent_node_id: rootId,
    });

    const children = await treeService.listChildren(rootId);
    expect(children.length).toBe(1);
    expect(children[0]!.id).toBe(childId);
  });

  it("delete_node removes node but keeps card", async () => {
    const { card, node_id } = await cardService.createCard({
      card_type: "knowledge",
      title: "Node to delete",
    });

    const deleted = await treeService.deleteNode(node_id);
    expect(deleted).toBe(true);

    // Card should still exist
    const fetched = await cardService.getCard(card.id);
    expect(fetched).not.toBeNull();

    // But node should be gone
    const node = await treeService.getNode(node_id);
    expect(node).toBeNull();
  });

  it("delete_node cascades to child nodes", async () => {
    const { node_id: parentId } = await cardService.createCard({
      card_type: "structure",
      title: "Parent",
    });
    const { node_id: childId, card: childCard } = await cardService.createCard({
      card_type: "knowledge",
      title: "Child",
      parent_node_id: parentId,
    });

    await treeService.deleteNode(parentId);

    // Child node should be gone due to CASCADE
    const child = await treeService.getNode(childId);
    expect(child).toBeNull();

    // Child card should still exist
    const card = await cardService.getCard(childCard.id);
    expect(card).not.toBeNull();
  });

  it("symlink: creates a symlink and compile_subtree detects cycle", async () => {
    const { card: cardA, node_id: nodeA } = await cardService.createCard({
      card_type: "structure",
      title: "A",
    });
    const { node_id: nodeB } = await cardService.createCard({
      card_type: "knowledge",
      title: "B",
      parent_node_id: nodeA,
    });

    // Create symlink of A under B (creates a cycle: A → B → A)
    const symlinkNode = await treeService.createSymlink(cardA.id, nodeB, undefined);
    expect(symlinkNode.is_symlink).toBe(true);
    expect(symlinkNode.card_id).toBe(cardA.id);

    // compile_subtree from A should not infinitely loop and should include cycle marker
    const { markdown } = await treeService.compileSubtree(nodeA, Number.MAX_SAFE_INTEGER);
    expect(markdown).toContain("*(cycle)*");
  });

  it("symlink expand: listChildren on symlink returns canonical children", async () => {
    // 구조: A(root) → B(child). A를 C(root2) 아래에 symlink(S)로 생성.
    // listChildren(S) → B가 포함되어야 한다.
    const { card: cardA, node_id: nodeA } = await cardService.createCard({
      card_type: "structure",
      title: "Symlink-Expand-A",
    });
    const { card: cardB } = await cardService.createCard({
      card_type: "knowledge",
      title: "Symlink-Expand-B",
      parent_node_id: nodeA,
    });
    const { node_id: nodeC } = await cardService.createCard({
      card_type: "structure",
      title: "Symlink-Expand-C",
    });

    // C 아래에 A의 symlink 노드 S 생성
    const symlinkS = await treeService.createSymlink(cardA.id, nodeC, undefined);
    expect(symlinkS.is_symlink).toBe(true);

    // listChildren(S) → canonical node A의 자식인 B가 포함되어야 한다
    const children = await treeService.listChildren(symlinkS.id);
    expect(children.some((n) => n.card_id === cardB.id)).toBe(true);
  });

  it("symlink compile: compile_subtree expands symlink children", async () => {
    // 구조: A(root) → B(child). C(root2) 아래에 A를 symlink로 생성.
    // compileSubtree(symlink node) 결과에 B의 title이 포함되어야 한다.
    const { card: cardA, node_id: nodeA } = await cardService.createCard({
      card_type: "structure",
      title: "Symlink-Compile-A",
    });
    await cardService.createCard({
      card_type: "knowledge",
      title: "Symlink-Compile-B",
      parent_node_id: nodeA,
    });
    const { node_id: nodeC } = await cardService.createCard({
      card_type: "structure",
      title: "Symlink-Compile-C",
    });

    // C 아래에 A의 symlink 노드 생성
    const symlinkNode = await treeService.createSymlink(cardA.id, nodeC, undefined);
    expect(symlinkNode.is_symlink).toBe(true);

    // compile from symlink node → B가 전개되어야 한다
    const { markdown: symlinkMd } = await treeService.compileSubtree(symlinkNode.id, 2);
    expect(symlinkMd).toContain("Symlink-Compile-B");
  });

  it("symlink canonical_path: listChildren on parent returns symlink with canonical_path", async () => {
    // 구조: Root → Child(A). Root2 아래에 A의 symlink 생성.
    // listChildren(Root2)에서 symlink의 canonical_path가 "Root / A" 형태로 포함되어야 한다.
    const { card: cardRoot, node_id: nodeRoot } = await cardService.createCard({
      card_type: "structure",
      title: "CanonPath-Root",
    });
    const { card: cardA } = await cardService.createCard({
      card_type: "knowledge",
      title: "CanonPath-A",
      parent_node_id: nodeRoot,
    });
    const { node_id: nodeRoot2 } = await cardService.createCard({
      card_type: "structure",
      title: "CanonPath-Root2",
    });

    // Root2 아래에 A의 symlink 생성
    await treeService.createSymlink(cardA.id, nodeRoot2, undefined);

    const children = await treeService.listChildren(nodeRoot2);
    expect(children.length).toBe(1);
    const symlinkChild = children[0]!;
    expect(symlinkChild.is_symlink).toBe(true);
    expect(symlinkChild.canonical_path).toBeTruthy();
    // breadcrumb은 "루트 제목 / 카드 제목" 형태여야 한다
    expect(symlinkChild.canonical_path).toContain("CanonPath-Root");
    expect(symlinkChild.canonical_path).toContain("CanonPath-A");
  });

  it("orphan symlink: canonical 노드 없을 때 canonical_path 미포함", async () => {
    // canonical 노드 없이 직접 symlink 노드만 삽입 (orphan 시뮬레이션)
    // card는 있지만 non-symlink 노드가 없으면 orphan
    const { card: cardX, node_id: nodeX } = await cardService.createCard({
      card_type: "knowledge",
      title: "OrphanCard",
    });
    const { node_id: nodeParent } = await cardService.createCard({
      card_type: "structure",
      title: "OrphanParent",
    });

    // non-symlink 노드(nodeX)를 삭제하여 orphan 상태 만들기
    await treeService.deleteNode(nodeX);

    // cardX의 symlink를 nodeParent 아래에 생성 (orphan: canonical 없음)
    await treeService.createSymlink(cardX.id, nodeParent, undefined);

    const children = await treeService.listChildren(nodeParent);
    expect(children.length).toBe(1);
    const orphanChild = children[0]!;
    expect(orphanChild.is_symlink).toBe(true);
    expect(orphanChild.canonical_path).toBeUndefined();
  });

  it("moves a node to a new parent", async () => {
    const { node_id: rootA } = await cardService.createCard({
      card_type: "structure",
      title: "Root A",
    });
    const { node_id: rootB } = await cardService.createCard({
      card_type: "structure",
      title: "Root B",
    });
    const { node_id: child } = await cardService.createCard({
      card_type: "knowledge",
      title: "Movable",
      parent_node_id: rootA,
    });

    const { node: moved } = await treeService.moveNode(child, { parent_node_id: rootB });
    expect(moved).not.toBeNull();
    expect(moved!.parent_node_id).toBe(rootB);

    const childrenA = await treeService.listChildren(rootA);
    const childrenB = await treeService.listChildren(rootB);
    expect(childrenA.some((n) => n.id === child)).toBe(false);
    expect(childrenB.some((n) => n.id === child)).toBe(true);
  });
});
