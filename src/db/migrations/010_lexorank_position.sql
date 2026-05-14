-- 010_lexorank_position.sql
-- Cycle A1 (260514.01.atom-ordering-redesign):
--   Convert tree_nodes.position from INTEGER to TEXT (byte-wise sortable key).
--   Drop the UNIQUE constraint to allow same-position siblings — race-safe.
--   Add a non-unique BTREE index for the (parent, position, id) tie-break.
--
-- IDEMPOTENCY: PostgreSQL has no schema_migrations tracking in atom, so this
--   file is re-executed on every server start. All operations use IF EXISTS /
--   IF NOT EXISTS guards or DO-block conditional checks.

-- A. Drop legacy UNIQUE partial indexes (introduced by 002_multi_agent.sql).
--    Race-resolution by UNIQUE is replaced by tie-break (parent, position, id).
DROP INDEX IF EXISTS uidx_tree_nodes_root_pos;
DROP INDEX IF EXISTS uidx_tree_nodes_child_pos;

-- B. Convert position INTEGER → TEXT COLLATE "C" (byte-wise sort).
--    Conversion is bijective for normal territory; park values (negative,
--    used transiently by batch.service park-and-assign) are defensively
--    mapped to a '!'-prefixed magnitude key. Park values should never
--    appear in permanent data, but the CASE protects against legacy snapshots.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tree_nodes'
      AND column_name = 'position'
      AND data_type = 'integer'
  ) THEN
    ALTER TABLE tree_nodes
      ALTER COLUMN position DROP DEFAULT;

    ALTER TABLE tree_nodes
      ALTER COLUMN position TYPE TEXT COLLATE "C"
      USING (
        CASE
          WHEN position < 0 THEN
            '!' || lpad((2000000000 + position)::text, 10, '0')
          ELSE
            lpad(position::text, 10, '0')
        END
      );

    ALTER TABLE tree_nodes
      ALTER COLUMN position SET DEFAULT '0000000000';
  END IF;
END $$;

-- C. New non-unique BTREE index for (parent, position, id) sort.
--    id is appended so SELECT ... ORDER BY position, id is index-supported
--    and gives a deterministic order even when two siblings share a key.
CREATE INDEX IF NOT EXISTS idx_tree_nodes_parent_pos_id
  ON tree_nodes(parent_node_id, position, id);
