import type pg from "pg";
import type { Card, CreateCardInput, UpdateCardInput } from "../../shared/types.js";

function rowToCard(row: Record<string, unknown>): Card {
  return {
    id: row["id"] as string,
    card_type: row["card_type"] as Card["card_type"],
    title: row["title"] as string,
    content: (row["content"] as string | null) ?? null,
    references: (row["references"] as string[]) ?? [],
    tags: (row["tags"] as string[]) ?? [],
    card_timestamp: row["card_timestamp"] as string,
    content_timestamp: (row["content_timestamp"] as string | null) ?? null,
    source_type: (row["source_type"] as string | null) ?? null,
    source_ref: (row["source_ref"] as string | null) ?? null,
    source_snapshot: (row["source_snapshot"] as string | null) ?? null,
    source_checksum: (row["source_checksum"] as string | null) ?? null,
    source_checked_at: (row["source_checked_at"] as string | null) ?? null,
    staleness: (row["staleness"] as Card["staleness"]) ?? "unverified",
    version: row["version"] as number,
    updated_at: row["updated_at"] as string,
  };
}

export async function insertCard(
  db: pg.Pool,
  input: CreateCardInput
): Promise<Card> {
  const result = await db.query(
    `INSERT INTO cards (card_type, title, content, tags, "references", content_timestamp, source_type, source_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      input.card_type,
      input.title,
      input.content ?? null,
      input.tags ?? [],
      input.references ?? [],
      input.content_timestamp ?? null,
      input.source_type ?? null,
      input.source_ref ?? null,
    ]
  );
  return rowToCard(result.rows[0]);
}

export async function selectCardById(
  db: pg.Pool,
  id: string
): Promise<Card | null> {
  const result = await db.query(`SELECT * FROM cards WHERE id = $1`, [id]);
  if (result.rows.length === 0) return null;
  return rowToCard(result.rows[0]);
}

export async function updateCardById(
  db: pg.Pool,
  id: string,
  input: UpdateCardInput,
  contentChanged: boolean
): Promise<Card | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (input.title !== undefined) {
    sets.push(`title = $${idx++}`);
    values.push(input.title);
  }
  if (input.content !== undefined) {
    sets.push(`content = $${idx++}`);
    values.push(input.content);
    // auto-update content_timestamp if caller didn't provide one
    if (contentChanged && input.content_timestamp === undefined) {
      sets.push(`content_timestamp = NOW()`);
    }
  }
  if (input.content_timestamp !== undefined) {
    sets.push(`content_timestamp = $${idx++}`);
    values.push(input.content_timestamp);
  }
  if (input.tags !== undefined) {
    sets.push(`tags = $${idx++}`);
    values.push(input.tags);
  }
  if (input.references !== undefined) {
    sets.push(`"references" = $${idx++}`);
    values.push(input.references);
  }
  if (input.source_type !== undefined) {
    sets.push(`source_type = $${idx++}`);
    values.push(input.source_type);
  }
  if (input.source_ref !== undefined) {
    sets.push(`source_ref = $${idx++}`);
    values.push(input.source_ref);
  }
  if (input.source_snapshot !== undefined) {
    sets.push(`source_snapshot = $${idx++}`);
    values.push(input.source_snapshot);
  }
  if (input.source_checksum !== undefined) {
    sets.push(`source_checksum = $${idx++}`);
    values.push(input.source_checksum);
  }
  if (input.source_checked_at !== undefined) {
    sets.push(`source_checked_at = $${idx++}`);
    values.push(input.source_checked_at);
  }

  // bump version
  sets.push(`version = version + 1`);

  if (sets.length === 0) return selectCardById(db, id);

  values.push(id);
  const result = await db.query(
    `UPDATE cards SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    values
  );
  if (result.rows.length === 0) return null;
  return rowToCard(result.rows[0]);
}

export async function deleteCardById(
  db: pg.Pool,
  id: string
): Promise<boolean> {
  const result = await db.query(`DELETE FROM cards WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function searchCards(
  db: pg.Pool,
  query: string,
  limit: number = 20
): Promise<Array<{ card_id: string; title: string; card_type: string; snippet: string; rank: number }>> {
  const result = await db.query(
    `SELECT
       id AS card_id,
       title,
       card_type,
       ts_headline('simple', coalesce(content, title), plainto_tsquery('simple', $1)) AS snippet,
       ts_rank(fts_vector, plainto_tsquery('simple', $1)) AS rank
     FROM cards
     WHERE fts_vector @@ plainto_tsquery('simple', $1)
     ORDER BY rank DESC
     LIMIT $2`,
    [query, limit]
  );
  return result.rows;
}
