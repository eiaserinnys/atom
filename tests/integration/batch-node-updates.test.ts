import { executeBatchOp } from "../../src/services/batch.service.js";
import * as cardService from "../../src/services/card.service.js";
import type { BatchNodeUpdateItem } from "../../src/shared/types.js";
import { getIntegrationTestPool, setupIntegrationTestDb } from "./integration-harness.js";

setupIntegrationTestDb();

describe("executeBatchOp — node_updates", () => {
  it("sets journal_limit on an existing node", async () => {
    const { node_id } = await cardService.createCard({
      card_type: "structure",
      title: "Target",
    });

    const result = await executeBatchOp({
      node_updates: [{ node_id, journal_limit: 15 }],
    });

    expect(result.node_updated).toContain(node_id);

    const row = await getIntegrationTestPool().query(
      "SELECT journal_limit FROM tree_nodes WHERE id = $1",
      [node_id]
    );
    expect(row.rows[0]["journal_limit"]).toBe(15);
  });

  it("updates symlink node journal_limit without redirecting to canonical", async () => {
    const { card, node_id: canonicalNodeId } = await cardService.createCard({
      card_type: "structure",
      title: "Canonical",
    });
    const { node_id: symlinkParentId } = await cardService.createCard({
      card_type: "structure",
      title: "Symlink parent",
    });
    const symlinkResult = await executeBatchOp({
      symlinks: [{ card_id: card.id, parent_node_id: symlinkParentId }],
    });
    const symlinkNodeId = symlinkResult.symlinked[0]!;

    const result = await executeBatchOp({
      node_updates: [{ node_id: symlinkNodeId, journal_limit: 5 }],
    });

    expect(result.node_updated).toEqual([symlinkNodeId]);

    const rows = await getIntegrationTestPool().query(
      "SELECT id, journal_limit, is_symlink FROM tree_nodes WHERE id = ANY($1::uuid[]) ORDER BY is_symlink",
      [[canonicalNodeId, symlinkNodeId]]
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]["id"]).toBe(canonicalNodeId);
    expect(rows.rows[0]["journal_limit"]).toBeNull();
    expect(rows.rows[0]["is_symlink"]).toBe(false);
    expect(rows.rows[1]["id"]).toBe(symlinkNodeId);
    expect(rows.rows[1]["journal_limit"]).toBe(5);
    expect(rows.rows[1]["is_symlink"]).toBe(true);
  });

  it("throws and rolls back when node_id does not exist", async () => {
    const { card: existing, node_id } = await cardService.createCard({
      card_type: "knowledge",
      title: "Existing",
    });
    const fakeNodeId = "00000000-0000-0000-0000-000000000000";

    await expect(
      executeBatchOp({
        updates: [{ card_id: existing.id, title: "Renamed" }],
        node_updates: [{ node_id: fakeNodeId, journal_limit: 15 }],
      })
    ).rejects.toThrow(/Node not found/);

    // Transaction rolled back: title must remain unchanged
    const card = await cardService.getCard(existing.id);
    expect(card!.title).toBe("Existing");

    // node itself exists, its journal_limit is still NULL
    const row = await getIntegrationTestPool().query(
      "SELECT journal_limit FROM tree_nodes WHERE id = $1",
      [node_id]
    );
    expect(row.rows[0]["journal_limit"]).toBeNull();
  });

  it("noop item (journal_limit undefined) does NOT include node_id in result.node_updated", async () => {
    // P1-2 regression: a no-op node_updates entry (no provided fields) must
    // stay symmetric with the standalone update_node({node_id}) omit path —
    // it should not be reported as a successful update because no UPDATE
    // statement was actually issued.
    //
    // Phase 2 will tighten the Zod schema so omitting journal_limit is
    // rejected at the input boundary; until then the service layer guards
    // the asymmetry, and this test pins that behaviour.
    const { node_id } = await cardService.createCard({
      card_type: "structure",
      title: "Target Noop",
    });

    // 비정상 호출자 시나리오 모방: TypeScript 인터페이스(P1-2 적용 후
    // BatchNodeUpdateItem.journal_limit이 required)와 Zod
    // (`batchNodeUpdateItemSchema`)를 모두 우회한 noop이 service 레이어에
    // 도달했을 때, service 레벨 partial-update 가드가
    // result.node_updated에서 noop을 제외하는지 검증한다. 정상
    // TypeScript 경로에서는 이 입력을 만들 수 없으므로 명시적 캐스팅을
    // 통해 안전망 회귀를 살려둔다.
    const result = await executeBatchOp({
      node_updates: [{ node_id } as unknown as BatchNodeUpdateItem],
    });

    expect(result.node_updated).not.toContain(node_id);
    expect(result.node_updated).toHaveLength(0);

    // Existing journal_limit must remain NULL (unchanged).
    const row = await getIntegrationTestPool().query(
      "SELECT journal_limit FROM tree_nodes WHERE id = $1",
      [node_id]
    );
    expect(row.rows[0]["journal_limit"]).toBeNull();
  });

  it("applies node_updates alongside other operations in order", async () => {
    const { node_id: targetNodeId } = await cardService.createCard({
      card_type: "structure",
      title: "Target",
    });

    const result = await executeBatchOp({
      creates: [
        { temp_id: "new", card_type: "knowledge", title: "New card" },
      ],
      node_updates: [{ node_id: targetNodeId, journal_limit: 6 }],
    });

    expect(result.created).toHaveLength(1);
    expect(result.node_updated).toEqual([targetNodeId]);

    const row = await getIntegrationTestPool().query(
      "SELECT journal_limit FROM tree_nodes WHERE id = $1",
      [targetNodeId]
    );
    expect(row.rows[0]["journal_limit"]).toBe(6);
  });
});
