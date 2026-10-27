import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { closeDb, getDb, runMigrations, setDb } from "../../src/db/client.js";
import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import {
  getOpenAIKeyForWorker,
  getOpenAIKeyMetadata,
  saveOpenAIKey,
  getEmbeddingProgress,
} from "../../src/db/queries/openai-settings.js";
import {
  deleteStaleEmbeddings,
  listEmbeddingCandidates,
  listStaleEmbeddingIds,
  markEmbeddingVersion,
  saveEmbedding,
} from "../../src/db/queries/embeddings.js";
import { createEmbeddingInput } from "../../src/services/embeddings/input.js";
import { serializeEmbedding } from "../../src/services/embeddings/binary.js";
import { FlatEmbeddingIndex } from "../../src/services/embeddings/flat-index.js";
import { createEmbeddingSync } from "../../src/services/embeddings/sync.js";
import { eventBus } from "../../src/events/eventBus.js";
import { EMBEDDING_POLICY } from "../../src/services/embeddings/policy.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sqliteMigrations = path.join(root, "src/db/migrations-sqlite");
const migrationPath = path.join(sqliteMigrations, "012_openai_embeddings.sql");
let dbPath = "";

async function seedCard(id: string, content: string | null, position: number, symlink = false) {
  await getDb().query(
    `INSERT INTO cards (id, card_type, title, content, tags, "references") VALUES ($1, 'knowledge', $2, $3, '[]', '[]')`,
    [id, `제목 ${id}`, content]
  );
  await getDb().query(
    `INSERT INTO tree_nodes (id, card_id, position, is_symlink) VALUES ($1, $2, $3, $4)`,
    [`node-${id}`, id, position, symlink]
  );
}

describe("SQLite embedding contract", () => {
  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `atom-embedding-contract-${crypto.randomUUID()}.db`);
    setDb(new SqliteAdapter(dbPath));
    await runMigrations(sqliteMigrations);
  });

  afterEach(async () => {
    await closeDb();
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${dbPath}${suffix}`, { force: true });
  });

  it("applies 012 twice, keeps the key out of public metadata, and round-trips embeddings", async () => {
    const migration = fs.readFileSync(migrationPath, "utf8");
    const raw = new Database(dbPath);
    raw.exec(migration);
    raw.exec(migration);
    raw.close();

    await saveOpenAIKey(getDb(), "test-key-value", "2026-10-26T00:00:00.000Z");
    const metadata = await getOpenAIKeyMetadata(getDb());
    const workerKey = await getOpenAIKeyForWorker(getDb());
    expect(metadata).toEqual({ configured: true, last_saved_at: "2026-10-26T00:00:00.000Z" });
    expect(workerKey === "test-key-value").toBe(true);
    expect(JSON.stringify(metadata).includes("test-key-value")).toBe(false);

    await seedCard("buffer-card", "본문", 1);
    const buffer = serializeEmbedding(new Float32Array(3072).fill(0.25));
    const input = await createEmbeddingInput("제목 buffer-card", "본문");
    expect(await saveEmbedding(getDb(), {
      cardId: "buffer-card", version: 1, contentHash: input.contentHash,
      tokenCount: input.tokenCount, truncated: input.truncated, embedding: buffer,
      embeddedAt: "2026-10-26T00:00:00.000Z",
    })).toBe(true);
    const stored = await getDb().query("SELECT embedding FROM card_embeddings WHERE card_id = $1", ["buffer-card"]);
    expect(stored.rows[0]["embedding"]).toHaveLength(12_288);
    expect(Buffer.from(stored.rows[0]["embedding"] as Uint8Array).equals(buffer)).toBe(true);
    await getDb().query("DELETE FROM cards WHERE id = $1", ["buffer-card"]);
    const cascaded = await getDb().query("SELECT card_id FROM card_embeddings WHERE card_id = $1", ["buffer-card"]);
    expect(cascaded.rows).toHaveLength(0);
  });

  it("filters cards without canonical nodes and deletes embeddings after the body is cleared", async () => {
    await seedCard("eligible", "body", 1);
    await seedCard("symlink-only", "body", 2, true);
    await seedCard("blank", "   ", 3);
    const candidates = await listEmbeddingCandidates(getDb(), null);
    expect(candidates.map(row => row.card_id)).toEqual(["eligible"]);
    expect(await getEmbeddingProgress(getDb())).toEqual({ target_cards: 1, completed_cards: 0 });

    const input = await createEmbeddingInput("제목 eligible", "body");
    const embedding = serializeEmbedding(new Float32Array(3072).fill(0.1));
    await saveEmbedding(getDb(), {
      cardId: "eligible", version: 1, contentHash: input.contentHash,
      tokenCount: input.tokenCount, truncated: input.truncated, embedding,
      embeddedAt: "2026-10-26T00:00:00.000Z",
    });
    expect(await getEmbeddingProgress(getDb())).toEqual({ target_cards: 1, completed_cards: 1 });
    await getDb().query("UPDATE cards SET content = '' WHERE id = $1", ["eligible"]);
    const stale = await listStaleEmbeddingIds(getDb());
    expect(stale).toEqual(["eligible"]);
    expect(await deleteStaleEmbeddings(getDb(), stale)).toEqual(["eligible"]);
  });

  it("updates only the version when the stored content hash still matches", async () => {
    await seedCard("version-card", "unchanged", 1);
    const input = await createEmbeddingInput("제목 version-card", "unchanged");
    const embedding = serializeEmbedding(new Float32Array(3072).fill(0.3));
    await saveEmbedding(getDb(), {
      cardId: "version-card", version: 1, contentHash: input.contentHash,
      tokenCount: input.tokenCount, truncated: input.truncated, embedding,
      embeddedAt: "2026-10-26T00:00:00.000Z",
    });
    await getDb().query("UPDATE cards SET version = 2 WHERE id = $1", ["version-card"]);
    expect((await listEmbeddingCandidates(getDb(), null)).map(row => row.card_id)).toEqual(["version-card"]);
    expect(await markEmbeddingVersion(getDb(), "version-card", input.contentHash, 2)).toBe(true);
    expect(await listEmbeddingCandidates(getDb(), null)).toEqual([]);
    const row = await getDb().query("SELECT card_version, embedded_at FROM card_embeddings WHERE card_id = $1", ["version-card"]);
    expect(row.rows[0]).toMatchObject({ card_version: 2, embedded_at: "2026-10-26T00:00:00.000Z" });
  });

  it("backfills and refreshes with a fake endpoint, then removes an embedding for a blank body", async () => {
    await seedCard("sync-card", "first body", 1);
    await saveOpenAIKey(getDb(), "sync-test-key", "2026-10-26T00:00:00.000Z");
    let requestCount = 0;
    const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestCount += 1;
      const body = JSON.parse(String(init?.body ?? "")) as { input: number[][] };
      return new Response(JSON.stringify({ data: body.input.map((_, index) => ({
        index, embedding: new Array<number>(3072).fill(requestCount / 10),
      })) }), { status: 200 });
    }) as typeof fetch;
    const sync = createEmbeddingSync({ db: getDb(), index: new FlatEmbeddingIndex(), fetcher });
    sync.requestRun();
    await sync.waitForIdle();
    expect(requestCount).toBe(1);
    expect((await getDb().query("SELECT card_version FROM card_embeddings WHERE card_id = $1", ["sync-card"])).rows).toHaveLength(1);

    await getDb().query("UPDATE cards SET content = $1, version = version + 1 WHERE id = $2", ["second body", "sync-card"]);
    sync.requestRun();
    await sync.waitForIdle();
    expect(requestCount).toBe(2);
    expect((await getDb().query("SELECT card_version FROM card_embeddings WHERE card_id = $1", ["sync-card"])).rows[0]["card_version"]).toBe(2);

    await getDb().query("UPDATE cards SET content = '', version = version + 1 WHERE id = $1", ["sync-card"]);
    sync.requestRun();
    await sync.waitForIdle();
    expect(requestCount).toBe(2);
    expect((await getDb().query("SELECT card_id FROM card_embeddings WHERE card_id = $1", ["sync-card"])).rows).toHaveLength(0);
    await sync.stop();
  });

  it("pauses on 401 and resumes only after credentials change", async () => {
    await seedCard("auth-card", "body", 1);
    await saveOpenAIKey(getDb(), "old-test-key", "2026-10-26T00:00:00.000Z");
    let requestCount = 0;
    const secretBody = ["fake", "upstream", "error"].join("-");
    const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestCount += 1;
      if (requestCount === 1) return new Response(secretBody, { status: 401 });
      const body = JSON.parse(String(init?.body ?? "")) as { input: number[][] };
      return new Response(JSON.stringify({ data: body.input.map((_, index) => ({ index, embedding: new Array<number>(3072).fill(0.2) })) }), { status: 200 });
    }) as typeof fetch;
    const logs: unknown[] = [];
    const sync = createEmbeddingSync({ db: getDb(), index: new FlatEmbeddingIndex(), fetcher, logger: { warn: record => logs.push(record) } });
    sync.requestRun();
    await sync.waitForIdle();
    expect(sync.status()).toMatchObject({ paused_reason: "auth", last_error: { kind: "OPENAI_AUTH", http_status: 401 } });
    sync.requestRun();
    await sync.waitForIdle();
    expect(requestCount).toBe(1);
    await saveOpenAIKey(getDb(), "new-test-key", "2026-10-26T00:00:01.000Z");
    sync.credentialsChanged();
    await sync.waitForIdle();
    expect(requestCount).toBe(2);
    expect(JSON.stringify({ logs, status: sync.status() }).includes(secretBody)).toBe(false);
    await sync.stop();
  });

  it("waits until the next sweep after an upstream error", async () => {
    await seedCard("retry-card", "body", 1);
    await saveOpenAIKey(getDb(), "retry-test-key", "2026-10-26T00:00:00.000Z");
    let clock = 10_000;
    let requestCount = 0;
    const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestCount += 1;
      if (requestCount === 1) return new Response("", { status: 503 });
      const body = JSON.parse(String(init?.body ?? "")) as { input: number[][] };
      return new Response(JSON.stringify({ data: body.input.map((_, index) => ({ index, embedding: new Array<number>(3072).fill(0.1) })) }), { status: 200 });
    }) as typeof fetch;
    const sync = createEmbeddingSync({ db: getDb(), index: new FlatEmbeddingIndex(), fetcher, now: () => clock });
    sync.requestRun();
    await sync.waitForIdle();
    expect(sync.status().last_error).toMatchObject({ kind: "OPENAI_UPSTREAM", http_status: 503 });
    sync.requestRun();
    await sync.waitForIdle();
    expect(requestCount).toBe(1);
    clock += 60_000;
    sync.requestRun();
    await sync.waitForIdle();
    expect(requestCount).toBe(2);
    await sync.stop();
  });

  it("honors Retry-After and resumes immediately only when the key changes", async () => {
    await seedCard("rate-card", "body", 1);
    await saveOpenAIKey(getDb(), "rate-first-test-key", "2026-10-26T00:00:00.000Z");
    let requestCount = 0;
    const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestCount += 1;
      if (requestCount === 1) return new Response("", { status: 429, headers: { "retry-after": "30" } });
      const body = JSON.parse(String(init?.body ?? "")) as { input: number[][] };
      return new Response(JSON.stringify({ data: body.input.map((_, index) => ({ index, embedding: new Array<number>(3072).fill(0.1) })) }), { status: 200 });
    }) as typeof fetch;
    const sync = createEmbeddingSync({ db: getDb(), index: new FlatEmbeddingIndex(), fetcher });
    sync.requestRun();
    await sync.waitForIdle();
    expect(sync.status()).toMatchObject({ paused_reason: "rate_limited", last_error: { kind: "OPENAI_RATE_LIMIT", http_status: 429 } });
    sync.requestRun();
    await sync.waitForIdle();
    expect(requestCount).toBe(1);
    await saveOpenAIKey(getDb(), "rate-second-test-key", "2026-10-26T00:00:01.000Z");
    sync.credentialsChanged();
    await sync.waitForIdle();
    expect(requestCount).toBe(2);
    await sync.stop();
  });

  it("does not save an upstream result after the card version changes", async () => {
    await seedCard("race-card", "before request", 1);
    await saveOpenAIKey(getDb(), "race-test-key", "2026-10-26T00:00:00.000Z");
    let requestCount = 0;
    const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestCount += 1;
      await getDb().query("UPDATE cards SET content = $1, version = version + 1 WHERE id = $2", ["edited during request", "race-card"]);
      const body = JSON.parse(String(init?.body ?? "")) as { input: number[][] };
      return new Response(JSON.stringify({ data: body.input.map((_, index) => ({ index, embedding: new Array<number>(3072).fill(0.1) })) }), { status: 200 });
    }) as typeof fetch;
    const sync = createEmbeddingSync({ db: getDb(), index: new FlatEmbeddingIndex(), fetcher });
    sync.requestRun();
    await sync.waitForIdle();
    expect(requestCount).toBe(1);
    expect((await getDb().query("SELECT card_id FROM card_embeddings WHERE card_id = $1", ["race-card"])).rows).toHaveLength(0);
    expect((await listEmbeddingCandidates(getDb(), null)).map(row => row.card_id)).toEqual(["race-card"]);
    await sync.stop();
  });

  it("aborts a running request on stop and uses events plus a sweep for updates", async () => {
    await seedCard("scheduler-card", "first", 1);
    await seedCard("sweep-card", "first body", 2);
    await saveOpenAIKey(getDb(), "scheduler-test-key", "2026-10-26T00:00:00.000Z");
    let requestCount = 0;
    const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestCount += 1;
      const body = JSON.parse(String(init?.body ?? "")) as { input: number[][] };
      return new Response(JSON.stringify({ data: body.input.map((_, index) => ({ index, embedding: new Array<number>(3072).fill(requestCount / 10) })) }), { status: 200 });
    }) as typeof fetch;
    let clock = Date.now();
    const sync = createEmbeddingSync({ db: getDb(), index: new FlatEmbeddingIndex(), fetcher, events: eventBus, now: () => clock });
    try {
      sync.start();
      await sync.waitForIdle();
      await getDb().query("UPDATE cards SET title = $1, version = version + 1 WHERE id = $2", ["event update", "scheduler-card"]);
      eventBus.emitAtomEvent({ type: "card:updated", cardId: "scheduler-card", data: {} as never, actor: null });
      await new Promise<void>(resolve => setTimeout(resolve, EMBEDDING_POLICY.debounceMs + 50));
      await sync.waitForIdle();
      expect(requestCount).toBe(2);

      await getDb().query("UPDATE cards SET content = $1, version = version + 1 WHERE id = $2", ["sweep update", "sweep-card"]);
      clock += EMBEDDING_POLICY.sweepIntervalMs;
      sync.requestRun();
      await sync.waitForIdle();
      expect(requestCount).toBe(3);
    } finally {
      await sync.stop();
    }

    await seedCard("abort-card", "pending", 2);
    await saveOpenAIKey(getDb(), "abort-test-key", "2026-10-26T00:00:02.000Z");
    let abortSignal: AbortSignal | undefined;
    const hangingFetch = (async (_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      abortSignal = init?.signal as AbortSignal;
      abortSignal.addEventListener("abort", () => reject(new Error("request stopped")), { once: true });
    })) as typeof fetch;
    const aborting = createEmbeddingSync({ db: getDb(), index: new FlatEmbeddingIndex(), fetcher: hangingFetch });
    aborting.requestRun();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    await aborting.stop();
    expect(abortSignal?.aborted).toBe(true);
  });
});
