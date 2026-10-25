import type { Queryable } from "../queryable.js";
import type { StoredEmbedding } from "../../services/embeddings/flat-index.js";
import { EMBEDDING_POLICY } from "../../services/embeddings/policy.js";

export interface EmbeddingCandidate {
  card_id: string;
  title: string;
  content: string;
  version: number;
  content_hash: string | null;
  model: string | null;
  dimensions: number | null;
}

export async function listStaleEmbeddingIds(db: Queryable): Promise<string[]> {
  const result = await db.query(
    `SELECT e.card_id
     FROM card_embeddings e
     JOIN cards c ON c.id = e.card_id
     WHERE (TRIM(COALESCE(c.content, '')) = ''
       OR NOT EXISTS (SELECT 1 FROM tree_nodes tn WHERE tn.card_id = c.id AND tn.is_symlink = FALSE))
     ORDER BY e.card_id
     LIMIT $1`,
    [EMBEDDING_POLICY.cleanupPageSize]
  );
  return result.rows.map(row => String(row["card_id"]));
}

export async function deleteStaleEmbeddings(db: Queryable, cardIds: string[]): Promise<string[]> {
  if (cardIds.length === 0) return [];
  const placeholders = cardIds.map((_, index) => `$${index + 1}`).join(", ");
  const result = await db.query(
    `DELETE FROM card_embeddings
     WHERE card_id IN (${placeholders})
       AND EXISTS (SELECT 1 FROM cards c WHERE c.id = card_embeddings.card_id
         AND (TRIM(COALESCE(c.content, '')) = ''
           OR NOT EXISTS (SELECT 1 FROM tree_nodes tn WHERE tn.card_id = c.id AND tn.is_symlink = FALSE)))
     RETURNING card_id`,
    cardIds
  );
  return result.rows.map(row => String(row["card_id"]));
}

export async function listEmbeddingCandidates(db: Queryable, afterId: string | null): Promise<EmbeddingCandidate[]> {
  const cursorFilter = afterId === null ? "" : "AND c.id > $3";
  const values = afterId === null
    ? [EMBEDDING_POLICY.model, EMBEDDING_POLICY.dimensions, EMBEDDING_POLICY.candidatePageSize]
    : [EMBEDDING_POLICY.model, EMBEDDING_POLICY.dimensions, afterId, EMBEDDING_POLICY.candidatePageSize];
  const limit = afterId === null ? "$3" : "$4";
  const result = await db.query(
    `SELECT c.id AS card_id, c.title, c.content, c.version,
            e.content_hash, e.model, e.dimensions
     FROM cards c LEFT JOIN card_embeddings e ON e.card_id = c.id
     WHERE TRIM(COALESCE(c.content, '')) <> ''
       AND EXISTS (SELECT 1 FROM tree_nodes tn WHERE tn.card_id = c.id AND tn.is_symlink = FALSE)
       AND (e.card_id IS NULL OR e.card_version <> c.version OR e.model <> $1 OR e.dimensions <> $2)
       ${cursorFilter}
     ORDER BY c.id LIMIT ${limit}`,
    values
  );
  return result.rows.map(row => ({
    card_id: String(row["card_id"]),
    title: String(row["title"]),
    content: String(row["content"]),
    version: Number(row["version"]),
    content_hash: row["content_hash"] === null ? null : String(row["content_hash"]),
    model: row["model"] === null ? null : String(row["model"]),
    dimensions: row["dimensions"] === null ? null : Number(row["dimensions"]),
  }));
}

export async function markEmbeddingVersion(
  db: Queryable,
  cardId: string,
  hash: string,
  version: number,
): Promise<boolean> {
  const result = await db.query(
    `UPDATE card_embeddings SET card_version = $1
     WHERE card_id = $2 AND content_hash = $3
       AND EXISTS (SELECT 1 FROM cards c WHERE c.id = card_embeddings.card_id AND c.version = $4
         AND TRIM(COALESCE(c.content, '')) <> ''
         AND EXISTS (SELECT 1 FROM tree_nodes tn WHERE tn.card_id = c.id AND tn.is_symlink = FALSE))
     RETURNING card_id`,
    [version, cardId, hash, version]
  );
  return result.rows.length > 0;
}

export async function saveEmbedding(
  db: Queryable,
  row: { cardId: string; version: number; contentHash: string; tokenCount: number; truncated: boolean; embedding: Buffer; embeddedAt: string },
): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO card_embeddings
       (card_id, model, dimensions, content_hash, card_version, token_count, truncated, embedding, embedded_at)
     SELECT c.id, $1, $2, $3, c.version, $4, $5, $6, $7
     FROM cards c WHERE c.id = $8 AND c.version = $9
       AND TRIM(COALESCE(c.content, '')) <> ''
       AND EXISTS (SELECT 1 FROM tree_nodes tn WHERE tn.card_id = c.id AND tn.is_symlink = FALSE)
     ON CONFLICT (card_id) DO UPDATE SET
       model = excluded.model, dimensions = excluded.dimensions,
       content_hash = excluded.content_hash, card_version = excluded.card_version,
       token_count = excluded.token_count, truncated = excluded.truncated,
       embedding = excluded.embedding, embedded_at = excluded.embedded_at
     RETURNING card_id`,
    [EMBEDDING_POLICY.model, EMBEDDING_POLICY.dimensions, row.contentHash, row.tokenCount, row.truncated,
      row.embedding, row.embeddedAt, row.cardId, row.version]
  );
  return result.rows.length > 0;
}

export async function listIndexEmbeddings(db: Queryable, afterId: string | null): Promise<StoredEmbedding[]> {
  const cursorFilter = afterId === null ? "" : "AND e.card_id > $3";
  const limit = afterId === null ? "$3" : "$4";
  const values = afterId === null
    ? [EMBEDDING_POLICY.model, EMBEDDING_POLICY.dimensions, EMBEDDING_POLICY.indexPageSize]
    : [EMBEDDING_POLICY.model, EMBEDDING_POLICY.dimensions, afterId, EMBEDDING_POLICY.indexPageSize];
  const result = await db.query(
    `SELECT e.card_id, e.card_version, e.embedding
     FROM card_embeddings e JOIN cards c ON c.id = e.card_id
     WHERE e.model = $1 AND e.dimensions = $2 AND e.card_version = c.version
       AND TRIM(COALESCE(c.content, '')) <> ''
       AND EXISTS (SELECT 1 FROM tree_nodes tn WHERE tn.card_id = c.id AND tn.is_symlink = FALSE)
       ${cursorFilter}
     ORDER BY e.card_id LIMIT ${limit}`,
    values
  );
  return result.rows.map(row => ({
    cardId: String(row["card_id"]),
    version: Number(row["card_version"]),
    embedding: row["embedding"] as Buffer,
  }));
}

export async function countIndexEmbeddings(db: Queryable): Promise<number> {
  const result = await db.query(
    `SELECT COUNT(*) AS count
     FROM card_embeddings e JOIN cards c ON c.id = e.card_id
     WHERE e.model = $1 AND e.dimensions = $2 AND e.card_version = c.version
       AND TRIM(COALESCE(c.content, '')) <> ''
       AND EXISTS (SELECT 1 FROM tree_nodes tn WHERE tn.card_id = c.id AND tn.is_symlink = FALSE)`,
    [EMBEDDING_POLICY.model, EMBEDDING_POLICY.dimensions]
  );
  return Number(result.rows[0]?.["count"] ?? 0);
}

export async function listCurrentEligibleVersions(db: Queryable): Promise<Map<string, number>> {
  const result = await db.query(
    `SELECT c.id AS card_id, c.version
     FROM cards c WHERE TRIM(COALESCE(c.content, '')) <> ''
       AND EXISTS (SELECT 1 FROM tree_nodes tn WHERE tn.card_id = c.id AND tn.is_symlink = FALSE)`
  );
  return new Map(result.rows.map(row => [String(row["card_id"]), Number(row["version"])]));
}
