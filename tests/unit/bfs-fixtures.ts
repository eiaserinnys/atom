import type { Card, TreeNode } from "../../src/shared/types.js";

export function makeCard(overrides: Partial<Card> & { id: string; title: string }): Card {
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

export function makeNode(overrides: Partial<TreeNode> & { id: string; card_id: string }): TreeNode {
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
