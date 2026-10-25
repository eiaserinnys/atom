import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, getDb, runMigrations, setDb } from "../../src/db/client.js";
import { PostgresAdapter } from "../../src/db/adapters/postgres.js";
import { getOpenAIKeyForWorker, getOpenAIKeyMetadata, saveOpenAIKey } from "../../src/db/queries/openai-settings.js";
import { listEmbeddingCandidates, markEmbeddingVersion, saveEmbedding } from "../../src/db/queries/embeddings.js";
import { createEmbeddingInput } from "../../src/services/embeddings/input.js";
import { serializeEmbedding } from "../../src/services/embeddings/binary.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrations = path.join(root, "src/db/migrations");
const migration012 = path.join(migrations, "012_openai_embeddings.sql");
const cardId = "10000000-0000-4000-8000-000000000001";
const nodeId = "20000000-0000-4000-8000-000000000001";

describe("PostgreSQL embedding contract", () => {
  beforeAll(async () => {
    const databaseUrl = process.env["TEST_DATABASE_URL"];
    if (!databaseUrl || !new URL(databaseUrl).pathname.toLowerCase().includes("test")) {
      throw new Error("A dedicated TEST_DATABASE_URL database is required");
    }
    const db = new PostgresAdapter(databaseUrl);
    setDb(db);
    await runMigrations(migrations);
    const counts = await db.query(
      `SELECT (SELECT COUNT(*) FROM cards) AS cards,
              (SELECT COUNT(*) FROM card_embeddings) AS embeddings,
              (SELECT COUNT(*) FROM app_settings) AS settings`
    );
    const row = counts.rows[0];
    if (Number(row["cards"]) !== 0 || Number(row["embeddings"]) !== 0 || Number(row["settings"]) !== 0) {
      await closeDb();
      throw new Error("The dedicated TEST_DATABASE_URL database must be empty before this suite");
    }
  }, 30_000);

  afterEach(async () => {
    await getDb().query("DELETE FROM cards");
    await getDb().query("DELETE FROM app_settings");
  });

  afterAll(async () => { await closeDb(); }, 10_000);

  it("runs 012 twice, separates public metadata from key access, and stores Float32LE bytes", async () => {
    const sql = fs.readFileSync(migration012, "utf8");
    await getDb().query(sql);
    await getDb().query(sql);
    await saveOpenAIKey(getDb(), "pg-test-key", "2026-10-26T00:00:00.000Z");
    const metadata = await getOpenAIKeyMetadata(getDb());
    const workerKey = await getOpenAIKeyForWorker(getDb());
    expect(metadata).toEqual({ configured: true, last_saved_at: "2026-10-26T00:00:00.000Z" });
    expect(workerKey === "pg-test-key").toBe(true);
    expect(JSON.stringify(metadata).includes("pg-test-key")).toBe(false);

    await getDb().query(
      `INSERT INTO cards (id, card_type, title, content, tags, "references")
       VALUES ($1, 'knowledge', 'PG contract', 'body', '{}', '{}')`,
      [cardId]
    );
    await getDb().query(
      `INSERT INTO tree_nodes (id, card_id, position, is_symlink) VALUES ($1, $2, 1, FALSE)`,
      [nodeId, cardId]
    );
    const input = createEmbeddingInput("PG contract", "body");
    const embedding = serializeEmbedding(new Float32Array(3072).fill(0.125));
    expect(await saveEmbedding(getDb(), {
      cardId, version: 1, contentHash: input.contentHash, tokenCount: input.tokenCount,
      truncated: input.truncated, embedding, embeddedAt: "2026-10-26T00:00:00.000Z",
    })).toBe(true);
    const stored = await getDb().query("SELECT embedding FROM card_embeddings WHERE card_id = $1", [cardId]);
    expect(stored.rows[0]["embedding"]).toHaveLength(12_288);
    expect(Buffer.from(stored.rows[0]["embedding"] as Uint8Array).equals(embedding)).toBe(true);
  });

  it("filters symlink-only cards and syncs a version-only change by hash", async () => {
    await getDb().query(
      `INSERT INTO cards (id, card_type, title, content, tags, "references")
       VALUES ($1, 'knowledge', 'PG contract', 'body', '{}', '{}'),
              ('10000000-0000-4000-8000-000000000002', 'knowledge', 'Orphan', 'body', '{}', '{}')`,
      [cardId]
    );
    await getDb().query(
      `INSERT INTO tree_nodes (id, card_id, position, is_symlink) VALUES ($1, $2, 1, FALSE),
       ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 2, TRUE)`,
      [nodeId, cardId]
    );
    const input = createEmbeddingInput("PG contract", "body");
    await saveEmbedding(getDb(), {
      cardId, version: 1, contentHash: input.contentHash, tokenCount: input.tokenCount,
      truncated: input.truncated, embedding: serializeEmbedding(new Float32Array(3072).fill(0.2)),
      embeddedAt: "2026-10-26T00:00:00.000Z",
    });
    expect((await listEmbeddingCandidates(getDb(), null)).map(row => row.card_id)).toEqual([]);
    await getDb().query("UPDATE cards SET version = 2 WHERE id = $1", [cardId]);
    expect(await markEmbeddingVersion(getDb(), cardId, input.contentHash, 2)).toBe(true);
    expect((await listEmbeddingCandidates(getDb(), null)).map(row => row.card_id)).toEqual([]);
    await getDb().query("DELETE FROM cards WHERE id = $1", [cardId]);
    const remaining = await getDb().query("SELECT card_id FROM card_embeddings WHERE card_id = $1", [cardId]);
    expect(remaining.rows).toHaveLength(0);
  });
});
