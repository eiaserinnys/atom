import type { Queryable } from "../queryable.js";
import type { EmbeddingPauseReason, OpenAIConfigResponse } from "../../shared/embeddings.js";
import { EMBEDDING_POLICY } from "../../services/embeddings/policy.js";

interface KeyMetadata {
  configured: boolean;
  last_saved_at: string | null;
}

function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function getOpenAIKeyMetadata(db: Queryable): Promise<KeyMetadata> {
  const result = await db.query(
    `SELECT openai_api_key IS NOT NULL AS configured, openai_key_saved_at AS last_saved_at
     FROM app_settings WHERE id = 1`
  );
  const row = result.rows[0];
  if (!row) return { configured: false, last_saved_at: null };
  return {
    configured: Boolean(row["configured"]),
    last_saved_at: toIso(row["last_saved_at"]),
  };
}

export async function getOpenAIKeyForWorker(db: Queryable): Promise<string | null> {
  const result = await db.query(`SELECT openai_api_key FROM app_settings WHERE id = 1`);
  const value = result.rows[0]?.["openai_api_key"];
  return typeof value === "string" ? value : null;
}

export async function saveOpenAIKey(db: Queryable, apiKey: string, savedAt: string): Promise<boolean> {
  const update = async (client: Queryable): Promise<boolean> => {
    const existing = await client.query(`SELECT openai_api_key FROM app_settings WHERE id = 1`);
    const changed = existing.rows[0]?.["openai_api_key"] !== apiKey;
    await client.query(
      `INSERT INTO app_settings (id, openai_api_key, openai_key_saved_at)
       VALUES (1, $1, $2)
       ON CONFLICT (id) DO UPDATE SET
         openai_api_key = excluded.openai_api_key,
         openai_key_saved_at = excluded.openai_key_saved_at`,
      [apiKey, savedAt]
    );
    return changed;
  };
  const transaction = (db as Queryable & { transaction?: <T>(fn: (client: Queryable) => Promise<T>) => Promise<T> }).transaction;
  return transaction ? await transaction.call(db, update) as boolean : update(db);
}

export async function deleteOpenAIKey(db: Queryable): Promise<{ changed: boolean; last_saved_at: string | null }> {
  const result = await db.query(
    `UPDATE app_settings SET openai_api_key = NULL WHERE id = 1 AND openai_api_key IS NOT NULL
     RETURNING openai_key_saved_at AS last_saved_at`
  );
  const row = result.rows[0];
  return {
    changed: row !== undefined,
    last_saved_at: row ? toIso(row["last_saved_at"]) : (await getOpenAIKeyMetadata(db)).last_saved_at,
  };
}

export async function getEmbeddingProgress(db: Queryable): Promise<{ target_cards: number; completed_cards: number }> {
  const result = await db.query(
    `SELECT COUNT(CASE WHEN TRIM(COALESCE(c.content, '')) <> ''
                         AND EXISTS (SELECT 1 FROM tree_nodes tn WHERE tn.card_id = c.id AND tn.is_symlink = FALSE)
                        THEN 1 END) AS target_cards,
            COUNT(CASE WHEN TRIM(COALESCE(c.content, '')) <> ''
                         AND EXISTS (SELECT 1 FROM tree_nodes tn WHERE tn.card_id = c.id AND tn.is_symlink = FALSE)
                         AND e.model = $1 AND e.dimensions = $2
                         AND e.card_version = c.version
                        THEN 1 END) AS completed_cards
     FROM cards c LEFT JOIN card_embeddings e ON e.card_id = c.id`,
    [EMBEDDING_POLICY.model, EMBEDDING_POLICY.dimensions]
  );
  const row = result.rows[0];
  return {
    target_cards: Number(row?.["target_cards"] ?? 0),
    completed_cards: Number(row?.["completed_cards"] ?? 0),
  };
}

export async function getOpenAIConfigResponse(
  db: Queryable,
  status: { running: boolean; paused_reason: EmbeddingPauseReason; last_error: OpenAIConfigResponse["embedding"]["last_error"] },
): Promise<OpenAIConfigResponse> {
  const [key, progress] = await Promise.all([getOpenAIKeyMetadata(db), getEmbeddingProgress(db)]);
  return {
    key,
    embedding: {
      model: EMBEDDING_POLICY.model,
      dimensions: EMBEDDING_POLICY.dimensions,
      ...progress,
      ...status,
    },
  };
}
