import type { Queryable } from "../queryable.js";

export async function selectCanonicalEvaluationNodeId(db: Queryable, cardId: string): Promise<string | null> {
  const result = await db.query(
    `SELECT * FROM tree_nodes
     WHERE card_id = $1 AND is_symlink = FALSE
     ORDER BY created_at, id LIMIT 1`,
    [cardId],
  );
  const nodeId = result.rows[0]?.["id"];
  return typeof nodeId === "string" ? nodeId : null;
}
