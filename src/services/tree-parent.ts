import type { Queryable } from "../db/queryable.js";
import { selectCanonicalNodeByCardId, selectNodeById } from "../db/queries/tree.js";

/** Resolve a write parent through a symlink using the same rule as tree reads. */
export async function resolveWriteParentNodeId(
  db: Queryable,
  parentNodeId: string | null
): Promise<string | null> {
  if (parentNodeId === null) return null;

  const node = await selectNodeById(db, parentNodeId);
  if (!node || !node.is_symlink) return parentNodeId;

  const canonical = await selectCanonicalNodeByCardId(db, node.card_id);
  return canonical?.id ?? node.id;
}
