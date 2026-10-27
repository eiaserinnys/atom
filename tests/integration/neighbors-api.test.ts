import Fastify from "fastify";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, getDb, runMigrations, setDb } from "../../src/db/client.js";
import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import { agentKeyVerifier } from "../../src/api/agent-key-auth.js";
import { createNeighborsRoutes } from "../../src/api/routes/neighbors.js";
import { saveOpenAIKey, deleteOpenAIKey } from "../../src/db/queries/openai-settings.js";
import { saveEmbedding } from "../../src/db/queries/embeddings.js";
import { createEmbeddingInput } from "../../src/services/embeddings/input.js";
import { FlatEmbeddingIndex } from "../../src/services/embeddings/flat-index.js";
import { serializeEmbedding } from "../../src/services/embeddings/binary.js";
import { createNeighborService } from "../../src/services/embeddings/neighbors.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrations = path.join(root, "src/db/migrations-sqlite");
const ids = {
  rootA: "30000000-0000-4000-8000-000000000001",
  source: "30000000-0000-4000-8000-000000000002",
  near: "30000000-0000-4000-8000-000000000003",
  rootB: "30000000-0000-4000-8000-000000000004",
  other: "30000000-0000-4000-8000-000000000005",
};
const nodes = {
  rootA: "40000000-0000-4000-8000-000000000001",
  source: "40000000-0000-4000-8000-000000000002",
  near: "40000000-0000-4000-8000-000000000003",
  rootB: "40000000-0000-4000-8000-000000000004",
  other: "40000000-0000-4000-8000-000000000005",
};
const agentSecret = "agent-test-key";
let dbPath = "";

function vector(first: number): Buffer {
  const values = new Float32Array(3072);
  values[0] = first;
  return serializeEmbedding(values);
}

async function seedCard(cardId: string, nodeId: string, title: string, content: string, position: number, parentNodeId: string | null, value: number, cardType: "structure" | "knowledge" = "knowledge") {
  await getDb().query(
    `INSERT INTO cards (id, card_type, title, content, tags, "references") VALUES ($1, $2, $3, $4, '[]', '[]')`,
    [cardId, cardType, title, content]
  );
  await getDb().query(
    `INSERT INTO tree_nodes (id, card_id, parent_node_id, position, is_symlink) VALUES ($1, $2, $3, $4, FALSE)`,
    [nodeId, cardId, parentNodeId, position]
  );
  const input = await createEmbeddingInput(title, content);
  await saveEmbedding(getDb(), {
    cardId, version: 1, contentHash: input.contentHash, tokenCount: input.tokenCount,
    truncated: input.truncated, embedding: vector(value), embeddedAt: "2026-10-26T00:00:00.000Z",
  });
}

describe("card neighbor APIs", () => {
  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `atom-neighbors-api-${crypto.randomUUID()}.db`);
    setDb(new SqliteAdapter(dbPath));
    await runMigrations(migrations);
    agentKeyVerifier.clear();
    const rootAContent = "root";
    await seedCard(ids.rootA, nodes.rootA, "Root A", rootAContent, 1, null, 0, "structure");
    await seedCard(ids.source, nodes.source, "Source card", "source **body**", 1, nodes.rootA, 1);
    await seedCard(ids.near, nodes.near, "Near card", "near **excerpt**", 2, nodes.rootA, 0.8);
    await seedCard(ids.rootB, nodes.rootB, "Root B", "root", 2, null, 0, "structure");
    await seedCard(ids.other, nodes.other, "Other card", "other body", 1, nodes.rootB, 0.4);
    await saveOpenAIKey(getDb(), "neighbors-test-key", "2026-10-26T00:00:00.000Z");
    const secretHash = await bcrypt.hash(agentSecret, 4);
    await getDb().query(
      `INSERT INTO agents (id, agent_id, secret_hash, display_name, is_active) VALUES ($1, $2, $3, $4, 1)`,
      ["50000000-0000-4000-8000-000000000001", "test-agent", secretHash, "Test Agent"]
    );
  });

  afterEach(async () => {
    agentKeyVerifier.clear();
    await closeDb();
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${dbPath}${suffix}`, { force: true });
  });

  function makeApp(index = new FlatEmbeddingIndex()) {
    const service = createNeighborService(getDb(), index);
    const app = Fastify({ logger: false });
    app.addHook("preHandler", async request => {
      request.jwtUser = { id: "viewer", email: "viewer@example.test", name: "Viewer", role: "viewer" };
    });
    app.register(createNeighborsRoutes(service));
    return { app, service, index };
  }

  async function loadIndex(index: FlatEmbeddingIndex) {
    const rows = await getDb().query(
      "SELECT card_id, card_version, embedding FROM card_embeddings ORDER BY card_id"
    );
    index.loadRows(rows.rows.map(row => ({ cardId: String(row["card_id"]), version: Number(row["card_version"]), embedding: row["embedding"] as Buffer })));
  }

  it("returns the same live neighbor DTO through JWT and agent-key routes with canonical paths", async () => {
    const index = new FlatEmbeddingIndex();
    await loadIndex(index);
    const { app } = makeApp(index);
    const jwt = await app.inject(`/cards/${ids.source}/neighbors?limit=1`);
    const agent = await app.inject({
      method: "GET",
      url: `/api/cards/${ids.source}/neighbors?limit=1`,
      headers: { "x-api-key": agentSecret },
    });
    expect(jwt.statusCode).toBe(200);
    expect(agent.statusCode).toBe(200);
    expect(agent.json()).toEqual(jwt.json());
    expect(jwt.json()).toMatchObject({
      status: "ready",
      key_configured: true,
      source: { card_id: ids.source, node_id: nodes.source, card_type: "knowledge", path: [{ node_id: nodes.rootA, title: "Root A" }] },
      neighbors: [{
        card_id: ids.near,
        node_id: nodes.near,
        card_type: "knowledge",
        title: "Near card",
        excerpt: "near excerpt",
        path: [{ node_id: nodes.rootA, title: "Root A" }],
        tree_relation: { common_ancestor_depth: 1, tree_distance: 2, same_top_level_branch: true },
      }],
    });
    const allNeighbors = await app.inject(`/cards/${ids.source}/neighbors?limit=4`);
    expect(allNeighbors.json().neighbors).toEqual(expect.arrayContaining([
      expect.objectContaining({ card_id: ids.rootA, card_type: "structure" }),
      expect.objectContaining({ card_id: ids.near, card_type: "knowledge" }),
    ]));
    expect(jwt.json().neighbors[0].similarity).toBeCloseTo(0.8, 6);
    expect(jwt.json().neighbors.some((row: { card_id: string }) => row.card_id === ids.source)).toBe(false);
    const broader = await app.inject(`/cards/${ids.source}/neighbors?limit=2`);
    expect(broader.json().neighbors[1]).toMatchObject({
      card_id: ids.other,
      tree_relation: { common_ancestor_depth: 0, tree_distance: 4, same_top_level_branch: false },
    });
    await app.close();
  });

  it("returns 202 while loading, then reports pending, blank, and out-of-tree sources distinctly", async () => {
    await getDb().query("DELETE FROM card_embeddings WHERE card_id = $1", [ids.source]);
    const { app, service } = makeApp();
    const loading = await app.inject(`/cards/${ids.source}/neighbors`);
    expect(loading.statusCode).toBe(202);
    expect(loading.headers["retry-after"]).toBe("1");
    await service.waitForLoad();
    const pending = await app.inject(`/cards/${ids.source}/neighbors`);
    expect(pending.statusCode).toBe(409);
    expect(pending.json().error).toMatchObject({ code: "EMBEDDING_NOT_READY", reason: "pending" });
    await getDb().query("UPDATE cards SET content = '' WHERE id = $1", [ids.source]);
    const blank = await app.inject(`/cards/${ids.source}/neighbors`);
    expect(blank.statusCode).toBe(422);
    await getDb().query("UPDATE cards SET content = 'restored' WHERE id = $1", [ids.source]);
    await getDb().query("DELETE FROM tree_nodes WHERE id = $1", [nodes.source]);
    const orphan = await app.inject(`/cards/${ids.source}/neighbors`);
    expect(orphan.statusCode).toBe(409);
    expect(orphan.json().error.code).toBe("CARD_NOT_IN_TREE");
    await app.close();
  });

  it("keeps saved vectors queryable after key deletion and rejects bad route inputs", async () => {
    const index = new FlatEmbeddingIndex();
    await loadIndex(index);
    const { app } = makeApp(index);
    await deleteOpenAIKey(getDb());
    const response = await app.inject(`/cards/${ids.source}/neighbors`);
    expect(response.statusCode).toBe(200);
    expect(response.json().key_configured).toBe(false);
    expect((await app.inject("/cards/nope/neighbors")).json().error.code).toBe("CARD_ID_INVALID");
    expect((await app.inject(`/cards/${ids.source}/neighbors?limit=51`)).json().error.code).toBe("NEIGHBOR_LIMIT_INVALID");
    expect((await app.inject(`/api/cards/${ids.source}/neighbors`)).statusCode).toBe(401);
    await app.close();
  });
});
