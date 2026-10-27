-- Move children stored beneath symlink rows to their canonical parent.
-- SQLite records applied migrations, and this statement is also idempotent.
WITH RECURSIVE hidden AS (
  SELECT
    child.id,
    canonical.id AS canonical_id,
    child.position AS old_position,
    child.created_at AS old_created_at
  FROM tree_nodes child
  JOIN tree_nodes alias ON alias.id = child.parent_node_id AND alias.is_symlink = 1
  JOIN tree_nodes canonical ON canonical.card_id = alias.card_id AND canonical.is_symlink = 0
), descendants(target_id, descendant_id, path) AS (
  SELECT hidden.id, hidden.id, '/' || hidden.id || '/'
  FROM hidden
  UNION ALL
  SELECT descendants.target_id, child.id, descendants.path || child.id || '/'
  FROM descendants
  JOIN tree_nodes child ON child.parent_node_id = descendants.descendant_id
  WHERE instr(descendants.path, '/' || child.id || '/') = 0
), safe AS (
  SELECT hidden.*
  FROM hidden
  WHERE hidden.id <> hidden.canonical_id
    AND NOT EXISTS (
      SELECT 1 FROM descendants
      WHERE descendants.target_id = hidden.id
        AND descendants.descendant_id = hidden.canonical_id
    )
), affected_parents AS (
  SELECT DISTINCT canonical_id FROM safe
), ranked AS (
  SELECT
    node.id,
    parent.canonical_id AS parent_id,
    printf(
      '%010d',
      (row_number() OVER (
        PARTITION BY parent.canonical_id
        ORDER BY
          CASE WHEN moved.id IS NULL THEN 0 ELSE 1 END,
          CASE WHEN moved.id IS NULL THEN node.position ELSE moved.old_position END ASC,
          CASE WHEN moved.id IS NULL THEN NULL ELSE moved.old_created_at END ASC,
          node.id ASC
      )) * 100
    ) AS new_position
  FROM affected_parents parent
  JOIN tree_nodes node
    ON node.parent_node_id = parent.canonical_id
    OR EXISTS (
      SELECT 1 FROM safe
      WHERE safe.id = node.id AND safe.canonical_id = parent.canonical_id
    )
  LEFT JOIN safe moved ON moved.id = node.id
)
UPDATE tree_nodes
SET parent_node_id = ranked.parent_id,
    position = ranked.new_position
FROM ranked
WHERE tree_nodes.id = ranked.id
  AND (tree_nodes.parent_node_id IS NOT ranked.parent_id
       OR tree_nodes.position <> ranked.new_position);
