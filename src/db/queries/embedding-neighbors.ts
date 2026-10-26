import type { Queryable } from "../queryable.js";

export interface NeighborCardRow {
  card_id: string;
  card_type: "structure" | "knowledge";
  title: string;
  content: string;
  version: number;
  node_id: string;
}

export interface NeighborPathRow {
  card_id: string;
  node_id: string;
  title: string;
  hops: number;
}

export async function getNeighborCardRows(db: Queryable, cardIds: string[]): Promise<NeighborCardRow[]> {
  if (cardIds.length === 0) return [];
  const ids = cardIds.map((_, index) => `$${index + 1}`).join(", ");
  const result = await db.query(
    `WITH chosen AS (
       SELECT tn.id AS node_id, tn.card_id,
              ROW_NUMBER() OVER (PARTITION BY tn.card_id ORDER BY tn.created_at, tn.id) AS rn
       FROM tree_nodes tn WHERE tn.is_symlink = FALSE AND tn.card_id IN (${ids})
     )
     SELECT c.id AS card_id, c.card_type, c.title, substr(c.content, 1, 4000) AS content, c.version, chosen.node_id
     FROM cards c JOIN chosen ON chosen.card_id = c.id AND chosen.rn = 1
     WHERE TRIM(COALESCE(c.content, '')) <> ''`,
    cardIds
  );
  return result.rows.map(row => ({
    card_id: String(row["card_id"]),
    card_type: row["card_type"] as NeighborCardRow["card_type"],
    title: String(row["title"]),
    content: String(row["content"]),
    version: Number(row["version"]),
    node_id: String(row["node_id"]),
  }));
}

export async function getNeighborPathRows(db: Queryable, cardIds: string[]): Promise<NeighborPathRow[]> {
  if (cardIds.length === 0) return [];
  const ids = cardIds.map((_, index) => `$${index + 1}`).join(", ");
  const result = await db.query(
    `WITH RECURSIVE chosen AS (
       SELECT tn.id, tn.card_id, tn.parent_node_id,
              ROW_NUMBER() OVER (PARTITION BY tn.card_id ORDER BY tn.created_at, tn.id) AS rn
       FROM tree_nodes tn WHERE tn.is_symlink = FALSE AND tn.card_id IN (${ids})
     ),
     chain(card_id, node_id, parent_node_id, title, hops, visited) AS (
       SELECT n.card_id, n.id, n.parent_node_id, c.title, 0,
              '|' || CAST(n.id AS TEXT) || '|'
       FROM chosen n JOIN cards c ON c.id = n.card_id WHERE n.rn = 1
       UNION ALL
       SELECT a.card_id, p.id, p.parent_node_id, c.title, a.hops + 1,
              a.visited || CAST(p.id AS TEXT) || '|'
       FROM chain a JOIN tree_nodes p ON p.id = a.parent_node_id
       JOIN cards c ON c.id = p.card_id
       WHERE a.visited NOT LIKE '%|' || CAST(p.id AS TEXT) || '|%'
     )
     SELECT card_id, node_id, title, hops FROM chain
     ORDER BY card_id, hops DESC`,
    cardIds
  );
  return result.rows.map(row => ({
    card_id: String(row["card_id"]),
    node_id: String(row["node_id"]),
    title: String(row["title"]),
    hops: Number(row["hops"]),
  }));
}
