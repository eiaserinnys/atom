-- 011_rekey_overflow_positions.sql (SQLite)
-- Normalize leaked normal-territory position keys above INT32_MAX.
--
-- SQLite tracks applied migrations with schema_migrations, but the UPDATE is
-- also safe to execute more than once. It rekeys every sibling under any parent
-- that currently contains a 10-digit numeric key above 2147483647.

UPDATE tree_nodes
SET position = ranked.new_position
FROM (
  SELECT
    tn_inner.id,
    printf(
      '%010d',
      (row_number() OVER (
        PARTITION BY tn_inner.parent_node_id
        ORDER BY tn_inner.position ASC, tn_inner.id ASC
      )) * 100
    ) AS new_position
  FROM tree_nodes tn_inner
  WHERE EXISTS (
    SELECT 1
    FROM tree_nodes overflow
    WHERE overflow.position GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
      AND CAST(overflow.position AS INTEGER) > 2147483647
      AND overflow.parent_node_id IS tn_inner.parent_node_id
  )
) AS ranked
WHERE tree_nodes.id = ranked.id
  AND tree_nodes.position <> ranked.new_position;
