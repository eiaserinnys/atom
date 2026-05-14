-- 010_lexorank_position.sql (SQLite)
-- Cycle A1: Convert tree_nodes.position from INTEGER to TEXT.
-- SQLite doesn't support direct column type changes, so the 12-step ALTER
-- pattern is used: create new table, copy data, drop old, rename.

-- A. Drop legacy UNIQUE partial indexes.
DROP INDEX IF EXISTS uidx_tree_nodes_root_pos;
DROP INDEX IF EXISTS uidx_tree_nodes_child_pos;

-- B. Create replacement table with TEXT position column.
--    NOTE: parent_node_id REFERENCES tree_nodes(id) — this uses the ORIGINAL
--    table name. After DROP/RENAME, SQLite preserves the FK by name, so the
--    final result is a valid self-referential FK on the renamed table.
--    Do NOT use tree_nodes_new(id) here — that would break the FK after RENAME.
CREATE TABLE tree_nodes_new (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  parent_node_id TEXT REFERENCES tree_nodes(id) ON DELETE CASCADE,
  position TEXT NOT NULL DEFAULT '0000000000' COLLATE BINARY,
  is_symlink INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  journal_limit INTEGER
);

-- C. Copy rows, converting position to zero-padded TEXT.
--    Negative positions (transient park values) get a '!' prefix.
-- Mirror runtime posToKey (src/shared/lexorank.ts) so byte-wise sort
-- matches what new inserts will produce. Park territory should not
-- appear in permanent data, but the defensive CASE keeps the SQL and
-- runtime conversions identical (design-principles §3).
INSERT INTO tree_nodes_new (id, card_id, parent_node_id, position, is_symlink, created_at, journal_limit)
SELECT
  id, card_id, parent_node_id,
  CASE
    WHEN position >= 0 THEN
      substr('0000000000' || position, -10)
    WHEN position >= -1000000000 THEN
      '"' || substr('0000000000' || (position + 1000000000), -10)
    WHEN position >= -2000000000 THEN
      '!' || substr('0000000000' || (position + 2000000000), -10)
    ELSE
      NULL
  END,
  is_symlink, created_at, journal_limit
FROM tree_nodes;

-- D. Swap tables.
DROP TABLE tree_nodes;
ALTER TABLE tree_nodes_new RENAME TO tree_nodes;

-- E. Recreate indexes (the previous indexes were dropped along with the old table).
CREATE INDEX IF NOT EXISTS idx_tree_nodes_card_id ON tree_nodes(card_id);
CREATE INDEX IF NOT EXISTS idx_tree_nodes_parent ON tree_nodes(parent_node_id);
CREATE INDEX IF NOT EXISTS idx_tree_nodes_parent_pos_id
  ON tree_nodes(parent_node_id, position, id);
