-- 011_rekey_overflow_positions.sql
-- Normalize leaked normal-territory position keys above INT32_MAX.
--
-- Runtime posToKey intentionally keeps the legacy public integer boundary
-- (0..2147483647). Cycle A1/A2 left a gap where TEXT keys above that boundary
-- could survive in tree_nodes and later be fed back into posToKey through
-- numeric public positions. This migration rekeys every sibling under any
-- affected parent to 100, 200, ... in current byte-sort order.
--
-- PostgreSQL migrations are re-executed on every server start in atom, so this
-- UPDATE is intentionally idempotent: once overflow keys are gone, the CTE is
-- empty and no rows are touched.

LOCK TABLE tree_nodes IN SHARE ROW EXCLUSIVE MODE;

WITH overflow_parents AS (
  SELECT parent_node_id
  FROM tree_nodes
  WHERE position ~ '^[0-9]{10}$'
    AND position::bigint > 2147483647
  GROUP BY parent_node_id
),
ranked AS (
  SELECT
    tn.id,
    lpad(
      ((row_number() OVER (
        PARTITION BY tn.parent_node_id
        ORDER BY tn.position COLLATE "C" ASC, tn.id ASC
      )) * 100)::text,
      10,
      '0'
    ) AS new_position
  FROM tree_nodes tn
  WHERE EXISTS (
    SELECT 1
    FROM overflow_parents op
    WHERE tn.parent_node_id IS NOT DISTINCT FROM op.parent_node_id
  )
)
UPDATE tree_nodes tn
SET position = ranked.new_position
FROM ranked
WHERE tn.id = ranked.id
  AND tn.position IS DISTINCT FROM ranked.new_position;
