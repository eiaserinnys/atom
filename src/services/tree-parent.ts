import type { Queryable } from "../db/queryable.js";
import { selectCanonicalNodeByCardId, selectNodeById } from "../db/queries/tree.js";

/** Resolve a node to its canonical parent, preserving missing-node information. */
export async function resolveParentNodeId(
  db: Queryable,
  nodeId: string
): Promise<string | null> {
  const node = await selectNodeById(db, nodeId);
  if (!node) return null;
  if (!node.is_symlink) return node.id;

  const canonical = await selectCanonicalNodeByCardId(db, node.card_id);
  return canonical?.id ?? node.id;
}

/** Resolve a write parent through a symlink, keeping missing IDs writable. */
export async function resolveWriteParentNodeId(
  db: Queryable,
  parentNodeId: string | null
): Promise<string | null> {
  if (parentNodeId === null) return null;
  return (await resolveParentNodeId(db, parentNodeId)) ?? parentNodeId;
}
