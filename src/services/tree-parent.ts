import type { Queryable } from "../db/queryable.js";
import { selectCanonicalNodeByCardId, selectNodeById } from "../db/queries/tree.js";
import { assertNodeExists, PARENT_NODE_SUBJECT } from "./service-errors.js";

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

/** Resolve a parent through a symlink to its canonical node; a missing node is a NotFoundError. */
export async function resolveWriteParentNodeId(
  db: Queryable,
  parentNodeId: string | null,
  subject = PARENT_NODE_SUBJECT
): Promise<string | null> {
  if (parentNodeId === null) return null;
  await assertNodeExists(db, parentNodeId, subject);
  return (await resolveParentNodeId(db, parentNodeId)) as string;
}
