import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { closeDb, getDb, runMigrations, setDb } from "../../src/db/client.js";
import { PostgresAdapter } from "../../src/db/adapters/postgres.js";
import { getOpenAIKeyForWorker, getOpenAIKeyMetadata, saveOpenAIKey } from "../../src/db/queries/openai-settings.js";
import { listEmbeddingCandidates, markEmbeddingVersion, saveEmbedding } from "../../src/db/queries/embeddings.js";
import { createNeighborsRoutes } from "../../src/api/routes/neighbors.js";
import { createEmbeddingInput } from "../../src/services/embeddings/input.js";
import { serializeEmbedding } from "../../src/services/embeddings/binary.js";
import { createEmbeddingSync } from "../../src/services/embeddings/sync.js";
import { createNeighborService } from "../../src/services/embeddings/neighbors.js";
import { FlatEmbeddingIndex } from "../../src/services/embeddings/flat-index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrations = path.join(root, "src/db/migrations");
const migration012 = path.join(migrations, "012_openai_embeddings.sql");
const cardId = "10000000-0000-4000-8000-000000000001";
const nodeId = "20000000-0000-4000-8000-000000000001";
const sourceCardId = "10000000-0000-4000-8000-000000000003";
const nearCardId = "10000000-0000-4000-8000-000000000004";
const sourceNodeId = "20000000-0000-4000-8000-000000000003";
const nearNodeId = "20000000-0000-4000-8000-000000000004";

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
    const input = await createEmbeddingInput("PG contract", "body");
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
    const input = await createEmbeddingInput("PG contract", "body");
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

  it("restores a tag-only version update through real index loading and neighbor lookup", async () => {
    await getDb().query(
      `INSERT INTO cards (id, card_type, title, content, tags, "references")
       VALUES ($1, 'knowledge', 'Source', 'source body', '{}', '{}'),
              ($2, 'knowledge', 'Near', 'near body', '{}', '{}')`,
      [sourceCardId, nearCardId]
    );
    await getDb().query(
      `INSERT INTO tree_nodes (id, card_id, position, is_symlink) VALUES
       ($1, $2, 1, FALSE), ($3, $4, 2, FALSE)`,
      [sourceNodeId, sourceCardId, nearNodeId, nearCardId]
    );
    await saveOpenAIKey(getDb(), "pg-neighbor-test-key", "2026-10-26T00:00:00.000Z");
    const sourceInput = await createEmbeddingInput("Source", "source body");
    const nearInput = await createEmbeddingInput("Near", "near body");
    const sourceVector = new Float32Array(3072);
    sourceVector[0] = 1;
    const nearVector = new Float32Array(3072);
    nearVector[0] = 0.8;
    for (const row of [
      { cardId: sourceCardId, input: sourceInput, vector: sourceVector },
      { cardId: nearCardId, input: nearInput, vector: nearVector },
    ]) {
      await saveEmbedding(getDb(), {
        cardId: row.cardId, version: 1, contentHash: row.input.contentHash,
        tokenCount: row.input.tokenCount, truncated: row.input.truncated,
        embedding: serializeEmbedding(row.vector), embeddedAt: "2026-10-26T00:00:00.000Z",
      });
    }

    await getDb().query("UPDATE cards SET tags = ARRAY['tagged'], version = version + 1 WHERE id = $1", [nearCardId]);
    const changed = await getDb().query(
      `SELECT c.title, c.content, c.version, e.content_hash
       FROM cards c JOIN card_embeddings e ON e.card_id = c.id WHERE c.id = $1`,
      [nearCardId]
    );
    expect(Number(changed.rows[0]["version"])).toBe(2);
    expect((await createEmbeddingInput(String(changed.rows[0]["title"]), String(changed.rows[0]["content"]))).contentHash)
      .toBe(String(changed.rows[0]["content_hash"]));
    expect((await listEmbeddingCandidates(getDb(), null)).map(row => row.card_id)).toEqual([nearCardId]);

    const index = new FlatEmbeddingIndex();
    const service = createNeighborService(getDb(), index);
    const app = Fastify({ logger: false });
    app.register(createNeighborsRoutes(service));
    const loading = await app.inject(`/cards/${sourceCardId}/neighbors?limit=4`);
    expect(loading.statusCode).toBe(202);
    await service.waitForLoad();
    const beforeSync = await app.inject(`/cards/${sourceCardId}/neighbors?limit=4`);
    expect(beforeSync.statusCode).toBe(200);
    expect(beforeSync.json().neighbors.map((row: { card_id: string }) => row.card_id)).not.toContain(nearCardId);

    let requestCount = 0;
    const sync = createEmbeddingSync({
      db: getDb(),
      index,
      fetcher: (async () => {
        requestCount += 1;
        throw new Error("unexpected OpenAI request for a tag-only update");
      }) as typeof fetch,
    });
    try {
      sync.requestRun();
      await sync.waitForIdle();
      expect(requestCount).toBe(0);
      const current = await getDb().query("SELECT card_version FROM card_embeddings WHERE card_id = $1", [nearCardId]);
      expect(Number(current.rows[0]["card_version"])).toBe(2);
      const afterSync = await app.inject(`/cards/${sourceCardId}/neighbors?limit=4`);
      expect(afterSync.statusCode).toBe(200);
      expect(afterSync.json().neighbors.map((row: { card_id: string }) => row.card_id)).toContain(nearCardId);
    } finally {
      await sync.stop();
      await app.close();
    }
  });
});
