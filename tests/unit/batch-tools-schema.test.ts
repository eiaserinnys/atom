import { batchNodeUpdateItemSchema } from "../../src/mcp/tools/batch_tools.js";

/**
 * P1-2 Zod rejection regression.
 *
 * batchNodeUpdateItemSchema enforces journal_limit as required (not optional).
 * The companion TypeScript interface BatchNodeUpdateItem (src/shared/types.ts)
 * mirrors this — both are the canonical source of input shape
 * (design-principles §3 정본 하나).
 *
 * Asymmetric with standalone update_node tool and PATCH /tree/:nodeId route,
 * both of which keep journal_limit optional (no-op read pattern is allowed).
 * The batch path treats noop items as input bug signals because batch_op is
 * a bulk-change operation.
 *
 * The integration test in tests/integration/batch.test.ts cannot exercise this
 * boundary because it calls executeBatchOp at the service layer (post-Zod).
 * Schema-level safeParse is the canonical surface for this regression.
 */
describe("batchNodeUpdateItemSchema (P1-2 Zod rejection)", () => {
  const validNodeId = "550e8400-e29b-41d4-a716-446655440000";

  it("rejects item without journal_limit (noop input)", () => {
    const result = batchNodeUpdateItemSchema.safeParse({
      node_id: validNodeId,
    });
    expect(result.success).toBe(false);
  });

  it("rejects item with journal_limit explicitly undefined", () => {
    const result = batchNodeUpdateItemSchema.safeParse({
      node_id: validNodeId,
      journal_limit: undefined,
    });
    expect(result.success).toBe(false);
  });

  it("accepts item with journal_limit: number", () => {
    const result = batchNodeUpdateItemSchema.safeParse({
      node_id: validNodeId,
      journal_limit: 5,
    });
    expect(result.success).toBe(true);
  });

  it("accepts item with journal_limit: 0 (unlimited)", () => {
    const result = batchNodeUpdateItemSchema.safeParse({
      node_id: validNodeId,
      journal_limit: 0,
    });
    expect(result.success).toBe(true);
  });

  it("accepts item with journal_limit: null (explicit clear via DB write)", () => {
    const result = batchNodeUpdateItemSchema.safeParse({
      node_id: validNodeId,
      journal_limit: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects item with negative journal_limit", () => {
    const result = batchNodeUpdateItemSchema.safeParse({
      node_id: validNodeId,
      journal_limit: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects item with non-integer journal_limit", () => {
    const result = batchNodeUpdateItemSchema.safeParse({
      node_id: validNodeId,
      journal_limit: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects item with non-uuid node_id", () => {
    const result = batchNodeUpdateItemSchema.safeParse({
      node_id: "not-a-uuid",
      journal_limit: 5,
    });
    expect(result.success).toBe(false);
  });
});
