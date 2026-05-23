/**
 * Integration tests split from api.test.ts.
 *
 * Requires TEST_DATABASE_URL to point to a test PostgreSQL database.
 */

import { setupIntegrationTestDb } from "./integration-harness.js";
import * as cardService from "../../src/services/card.service.js";
import * as treeService from "../../src/services/tree.service.js";

setupIntegrationTestDb();

describe("journal_limit", () => {
  it("PATCH /tree/:nodeId sets journal_limit and getNode returns it", async () => {
    const { node_id } = await cardService.createCard({
      card_type: "structure",
      title: "JournalParent",
    });

    const updated = await treeService.updateNodeProperties(node_id, { journal_limit: 3 });
    expect(updated).not.toBeNull();
    expect(updated!.journal_limit).toBe(3);

    const fetched = await treeService.getNode(node_id);
    expect(fetched).not.toBeNull();
    expect(fetched!.journal_limit).toBe(3);
  });

  it("journal_limit=N limits compile_subtree to N most recent children", async () => {
    const { node_id: parentId } = await cardService.createCard({
      card_type: "structure",
      title: "Journal",
    });

    // 자식 4개 생성 (position 오름차순으로 추가됨)
    for (const title of ["Child1", "Child2", "Child3", "Child4"]) {
      await cardService.createCard({ card_type: "knowledge", title, parent_node_id: parentId });
    }

    // journal_limit=2: 최신 2개(position 역순 기준 상위 2개)만 컴파일에 포함
    await treeService.updateNodeProperties(parentId, { journal_limit: 2 });
    const { markdown } = await treeService.compileSubtree(parentId, 2);

    // position이 높을수록 최신 → Child3, Child4 포함, Child1, Child2 미포함
    expect(markdown).not.toContain("Child1");
    expect(markdown).not.toContain("Child2");
    expect(markdown).toContain("Child3");
    expect(markdown).toContain("Child4");
  });

  it("journal_limit=0 includes all children (unlimited)", async () => {
    const { node_id: parentId } = await cardService.createCard({
      card_type: "structure",
      title: "JournalAll",
    });

    for (const title of ["A1", "A2", "A3", "A4", "A5"]) {
      await cardService.createCard({ card_type: "knowledge", title, parent_node_id: parentId });
    }

    await treeService.updateNodeProperties(parentId, { journal_limit: 0 });
    const { markdown } = await treeService.compileSubtree(parentId, 2);

    // 0이면 전체 포함
    expect(markdown).toContain("A1");
    expect(markdown).toContain("A5");
  });

  it("nested journal_limit applies independently per node", async () => {
    // 구조: Root(journal_limit=2) → Grp1(journal_limit=1) → [X1, X2]
    //                              → Grp2(journal_limit=null) → [Y1, Y2]
    const { node_id: rootId } = await cardService.createCard({
      card_type: "structure", title: "NestedRoot",
    });
    const { node_id: grp1Id } = await cardService.createCard({
      card_type: "structure", title: "Grp1", parent_node_id: rootId,
    });
    const { node_id: grp2Id } = await cardService.createCard({
      card_type: "structure", title: "Grp2", parent_node_id: rootId,
    });

    await cardService.createCard({ card_type: "knowledge", title: "X1", parent_node_id: grp1Id });
    await cardService.createCard({ card_type: "knowledge", title: "X2", parent_node_id: grp1Id });
    await cardService.createCard({ card_type: "knowledge", title: "Y1", parent_node_id: grp2Id });
    await cardService.createCard({ card_type: "knowledge", title: "Y2", parent_node_id: grp2Id });

    // Root: journal_limit=2 → Grp1, Grp2 모두 포함 (자식 2개)
    // Grp1: journal_limit=1 → X1, X2 중 최신 1개만 (X2)
    // Grp2: journal_limit=null → Y1, Y2 모두 포함
    await treeService.updateNodeProperties(rootId, { journal_limit: 2 });
    await treeService.updateNodeProperties(grp1Id, { journal_limit: 1 });

    const { markdown } = await treeService.compileSubtree(rootId, 3);

    expect(markdown).toContain("Grp1");
    expect(markdown).toContain("Grp2");
    expect(markdown).not.toContain("X1");
    expect(markdown).toContain("X2");
    expect(markdown).toContain("Y1");
    expect(markdown).toContain("Y2");
  });

  it("updateNodeProperties with empty or undefined props preserves journal_limit (partial-update regression)", async () => {
    const { node_id } = await cardService.createCard({
      card_type: "structure",
      title: "PartialUpdate",
    });

    // 먼저 journal_limit을 설정
    await treeService.updateNodeProperties(node_id, { journal_limit: 7 });

    // 1) 키가 아예 없는 경우
    const r1 = await treeService.updateNodeProperties(node_id, {});
    expect(r1!.journal_limit).toBe(7);

    // 2) 키는 있지만 값이 undefined인 경우 (Zod/JSON 경계를 통과한 payload 시뮬레이션)
    const r2 = await treeService.updateNodeProperties(node_id, { journal_limit: undefined });
    expect(r2!.journal_limit).toBe(7);

    // 3) 명시적 null은 여전히 클리어해야 한다
    const r3 = await treeService.updateNodeProperties(node_id, { journal_limit: null });
    expect(r3!.journal_limit).toBeNull();

    const fetched = await treeService.getNode(node_id);
    expect(fetched!.journal_limit).toBeNull();
  });

  it("update_node on symlink does NOT redirect to canonical (symlink stores its own journal_limit)", async () => {
    // P1-4 회귀: tree.service.ts updateNodeProperties는 symlink 노드에 대해
    // journal_limit을 *symlink 자체*에 저장하고 canonical로 redirect하지
    // 않는다 (의도된 설계). docstring에만 있던 정책을 테스트로 고정한다.
    const { card: cardX, node_id: canonicalNodeId } = await cardService.createCard({
      card_type: "structure",
      title: "SymRoot",
    });

    // 다른 부모 노드를 만들어 symlink를 그 아래에 둔다
    const { node_id: parentBId } = await cardService.createCard({
      card_type: "structure",
      title: "ParentB",
    });

    // parentB 아래 cardX의 symlink 생성 — positional 시그니처
    const symlinkNode = await treeService.createSymlink(cardX.id, parentBId);

    // act: symlink node_id에 update_node({journal_limit: 5})
    const updatedSymlink = await treeService.updateNodeProperties(symlinkNode.id, {
      journal_limit: 5,
    });

    // assert: symlink 노드 자체에 journal_limit=5 저장 (canonical로 redirect 안 됨)
    expect(updatedSymlink).not.toBeNull();
    expect(updatedSymlink!.journal_limit).toBe(5);
    expect(updatedSymlink!.is_symlink).toBe(true);

    // canonical 노드는 변경 없음 — 별도로 update하지 않았으므로 null 유지
    const canonicalAfter = await treeService.getNode(canonicalNodeId);
    expect(canonicalAfter).not.toBeNull();
    expect(canonicalAfter!.journal_limit).toBeNull();
    expect(canonicalAfter!.is_symlink).toBe(false);
  });

  it("update_node omit returns node with same response shape as a real update (response shape regression)", async () => {
    // P1-5 회귀: omit 호출(`updateNodeProperties(node_id, {})`)이 정상 update와
    // 응답 객체의 키 셋이 동일한지 검증한다. 기존 L1020 케이스가 *값 보존*을
    // 검증하는 것과 직교 — 본 케이스는 *구조 회귀*만 가드한다. 응답 객체에서
    // 필드 하나가 누락되어도 값 보존 테스트는 잡지 못하므로 직교 방어가 필요.
    const { node_id } = await cardService.createCard({
      card_type: "structure",
      title: "OmitShapeTest",
    });

    // 정상 update 응답 구조 캡처
    const updateResp = await treeService.updateNodeProperties(node_id, {
      journal_limit: 3,
    });
    expect(updateResp).not.toBeNull();
    const realUpdateKeys = Object.keys(updateResp!).sort();

    // omit (빈 props) 응답 구조 캡처
    const omitResp = await treeService.updateNodeProperties(node_id, {});
    expect(omitResp).not.toBeNull();
    const omitKeys = Object.keys(omitResp!).sort();

    // 응답 객체 키 셋 동일 — 필수 필드 누락 없음 (구조 회귀 보호)
    expect(omitKeys).toEqual(realUpdateKeys);

    // 추가 검증: 식별자 일치, 값은 유지(omit이라 update 결과 그대로)
    expect(omitResp!.id).toBe(node_id);
    expect(omitResp!.card_id).toBe(updateResp!.card_id);
    expect(omitResp!.journal_limit).toBe(3);
  });
});
