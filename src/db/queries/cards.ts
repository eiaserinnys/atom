import type { Card, CreateCardInput, UpdateCardInput } from "../../shared/types.js";
import type { Queryable } from "../queryable.js";
import { serializeArray, deserializeArray } from "../utils.js";

function rowToCard(row: Record<string, unknown>): Card {
  return {
    id: row["id"] as string,
    card_type: row["card_type"] as Card["card_type"],
    title: row["title"] as string,
    content: (row["content"] as string | null) ?? null,
    references: deserializeArray(row["references"]),
    tags: deserializeArray(row["tags"]),
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
    created_by: (row["created_by"] as string | null) ?? null,
    updated_by: (row["updated_by"] as string | null) ?? null,
  };
}

export async function insertCard(
  db: Queryable,
  input: CreateCardInput,
  agentId?: string
): Promise<Card> {
  const id = crypto.randomUUID();
  const result = await db.query(
    `INSERT INTO cards (id, card_type, title, content, tags, "references", content_timestamp, source_type, source_ref, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
     RETURNING *`,
    [
      id,
      input.card_type,
      input.title,
      input.content ?? null,
      serializeArray(input.tags ?? []),
      serializeArray(input.references ?? []),
      input.content_timestamp ?? null,
      input.source_type ?? null,
      input.source_ref ?? null,
      agentId ?? null,
    ]
  );
  return rowToCard(result.rows[0]);
}

export async function selectCardById(
  db: Queryable,
  id: string
): Promise<Card | null> {
  const result = await db.query(`SELECT * FROM cards WHERE id = $1`, [id]);
  if (result.rows.length === 0) return null;
  return rowToCard(result.rows[0]);
}

export type UpdateCardResult =
  | { card: Card; conflict: false }
  | { conflict: true; actualVersion: number }
  | null;

export async function updateCardById(
  db: Queryable,
  id: string,
  input: UpdateCardInput,
  contentChanged: boolean,
  agentId?: string,
  expectedVersion?: number
): Promise<UpdateCardResult> {
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
    values.push(serializeArray(input.tags));
  }
  if (input.references !== undefined) {
    sets.push(`"references" = $${idx++}`);
    values.push(serializeArray(input.references));
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
  if (input.staleness !== undefined) {
    sets.push(`staleness = $${idx++}`);
    values.push(input.staleness);
  }

  // bump version
  sets.push(`version = version + 1`);

  // update updated_by if agentId provided
  if (agentId !== undefined) {
    sets.push(`updated_by = $${idx++}`);
    values.push(agentId);
  }

  if (sets.length === 0) {
    const card = await selectCardById(db, id);
    if (!card) return null;
    return { card, conflict: false };
  }

  const idParamIdx = idx++;
  values.push(id);

  let whereClause = `WHERE id = $${idParamIdx}`;
  if (expectedVersion !== undefined) {
    whereClause += ` AND version = $${idx++}`;
    values.push(expectedVersion);
  }

  const result = await db.query(
    `UPDATE cards SET ${sets.join(", ")} ${whereClause} RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    if (expectedVersion === undefined) {
      // card doesn't exist
      return null;
    }
    // Either card doesn't exist or version mismatch — check which
    const existing = await selectCardById(db, id);
    if (!existing) return null;
    return { conflict: true, actualVersion: existing.version };
  }

  return { card: rowToCard(result.rows[0]), conflict: false };
}

export async function deleteCardById(
  db: Queryable,
  id: string
): Promise<boolean> {
  const result = await db.query(`DELETE FROM cards WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function updateCardSnapshot(
  db: Queryable,
  cardId: string,
  snapshot: string
): Promise<void> {
  await db.query(
    `UPDATE cards
     SET source_snapshot = $1,
         source_checked_at = NOW(),
         staleness = 'fresh'
     WHERE id = $2`,
    [snapshot, cardId]
  );
}

export async function updateCardSourceType(
  db: Queryable,
  cardId: string,
  sourceType: string
): Promise<void> {
  await db.query(
    `UPDATE cards SET source_type = $1 WHERE id = $2`,
    [sourceType, cardId]
  );
}

export async function searchCards(
  db: Queryable,
  query: string,
  limit: number = 20
): Promise<Array<{ card_id: string; title: string; card_type: string; snippet: string; rank: number }>> {
  const { getDb } = await import("../client.js");
  const dbType = getDb().dbType;

  if (dbType === "sqlite") {
    const result = await db.query(
      `SELECT
         c.id AS card_id,
         c.title,
         c.card_type,
         snippet(cards_fts, -1, '<b>', '</b>', '...', 20) AS snippet,
         cards_fts.rank AS rank
       FROM cards_fts
       JOIN cards c ON c.rowid = cards_fts.rowid
       WHERE cards_fts MATCH $1
       ORDER BY rank
       LIMIT $2`,
      [query, limit]
    );
    return result.rows;
  }

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
