-- 016_rekey_duplicate_positions.sql
-- Rekey every child of parents whose position keys contain duplicates.
--
-- PostgreSQL runs migrations on every server start. Once duplicate positions
-- are gone, duplicate_parents is empty and this UPDATE touches zero rows.

LOCK TABLE tree_nodes IN SHARE ROW EXCLUSIVE MODE;

WITH duplicate_parents AS (
  SELECT parent_node_id
  FROM tree_nodes
  GROUP BY parent_node_id
  HAVING COUNT(*) > COUNT(DISTINCT position)
),
ranked AS (
  SELECT
    tn.id,
    lpad(
      ((row_number() OVER (
        PARTITION BY tn.parent_node_id
        ORDER BY tn.position COLLATE "C" ASC, tn.created_at ASC, tn.id ASC
      )) * 100)::text,
      10,
      '0'
    ) AS new_position
  FROM tree_nodes tn
  WHERE EXISTS (
    SELECT 1
    FROM duplicate_parents dp
    WHERE tn.parent_node_id IS NOT DISTINCT FROM dp.parent_node_id
  )
)
UPDATE tree_nodes tn
SET position = ranked.new_position
FROM ranked
WHERE tn.id = ranked.id
  AND tn.position IS DISTINCT FROM ranked.new_position;
