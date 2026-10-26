import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, getDb, runMigrations, setDb } from "../../src/db/client.js";
import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import { insertCard } from "../../src/db/queries/cards.js";
import { insertNode } from "../../src/db/queries/tree.js";
import { loadEvaluationCandidates } from "../../src/services/jev-search/evaluate.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrations = path.join(root, "src/db/migrations-sqlite");
let dbPath = "";

describe("evaluation candidate loader", () => {
  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `atom-jev-evaluate-${crypto.randomUUID()}.db`);
    setDb(new SqliteAdapter(dbPath));
    await runMigrations(migrations);
  });

  afterEach(async () => {
    await closeDb();
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${dbPath}${suffix}`, { force: true });
  });

  it("loads canonical cards with ancestor paths and reports missing, bodyless, and orphan cards in order", async () => {
    const db = getDb();
    const rootCard = await insertCard(db, { card_type: "structure", title: "프로젝트", content: "모음" });
    const rootNode = await insertNode(db, rootCard.id, null, 1, false);
    const target = await insertCard(db, { card_type: "knowledge", title: "평가 대상", content: "직접 도움이 되는 본문" });
    const targetNode = await insertNode(db, target.id, rootNode.id, 1, false);
    const aliasNode = await insertNode(db, target.id, null, 2, true);
    const blank = await insertCard(db, { card_type: "knowledge", title: "빈 카드", content: "   " });
    await insertNode(db, blank.id, null, 3, false);
    const orphan = await insertCard(db, { card_type: "knowledge", title: "트리 밖", content: "본문" });
    const missingId = "10000000-0000-4000-8000-000000000099";

    const loaded = await loadEvaluationCandidates([missingId, blank.id, orphan.id, target.id], new AbortController().signal);

    expect(aliasNode.is_symlink).toBe(true);
    expect(loaded.skipped).toEqual([
      { card_id: missingId, reason: "CARD_NOT_FOUND" },
      { card_id: blank.id, reason: "NO_BODY" },
      { card_id: orphan.id, reason: "NO_CANONICAL_NODE" },
    ]);
    expect(loaded.candidates).toEqual([expect.objectContaining({
      cardId: target.id,
      nodeId: targetNode.id,
      cardVersion: target.version,
      path: ["프로젝트", "평가 대상"],
      summary: "직접 도움이 되는 본문",
    })]);
  });
});
