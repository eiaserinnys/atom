-- 016_rekey_duplicate_positions.sql (SQLite)
-- Rekey every child of parents whose position keys contain duplicates.
-- schema_migrations applies this file once; the UPDATE is also idempotent.

WITH duplicate_parents AS (
  SELECT parent_node_id
  FROM tree_nodes
  GROUP BY parent_node_id
  HAVING COUNT(*) > COUNT(DISTINCT position)
),
ranked AS (
  SELECT
    tn.id,
    printf(
      '%010d',
      (row_number() OVER (
        PARTITION BY tn.parent_node_id
        ORDER BY tn.position ASC, tn.created_at ASC, tn.id ASC
      )) * 100
    ) AS new_position
  FROM tree_nodes tn
  WHERE EXISTS (
    SELECT 1
    FROM duplicate_parents dp
    WHERE dp.parent_node_id IS tn.parent_node_id
  )
)
UPDATE tree_nodes
SET position = ranked.new_position
FROM ranked
WHERE tree_nodes.id = ranked.id
  AND tree_nodes.position <> ranked.new_position;
