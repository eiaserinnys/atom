import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrations = path.join(root, "src/db/migrations-sqlite");
const tsxEntry = path.join(root, "node_modules/tsx/dist/cli.mjs");
const seedScript = path.join(root, "scripts/seed-demo.ts");
let temp: string;
let sqlitePath: string;
let seedPath: string;

beforeEach(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "atom-u5-seed-"));
  sqlitePath = path.join(temp, "atom.db");
  seedPath = path.join(temp, "seed.json");
});

afterEach(() => {
  fs.rmSync(temp, { recursive: true, force: true });
});

function writeSeed(entries: unknown[]): void {
  fs.writeFileSync(seedPath, JSON.stringify(entries), "utf-8");
}

function runSeed(args: string[]): SpawnSyncReturns<string> {
  const env: NodeJS.ProcessEnv = { ...process.env, SQLITE_PATH: sqlitePath };
  delete env.DATABASE_URL;
  delete env.TEST_DATABASE_URL;
  return spawnSync(process.execPath, [tsxEntry, seedScript, ...args], {
    cwd: root,
    env,
    encoding: "utf-8",
    timeout: 60000,
  });
}

function getSeedCounts(): { cards: number; treeNodes: number } {
  const db = new Database(sqlitePath, { readonly: true });
  try {
    const cards = db.prepare("SELECT count(*) AS count FROM cards").get() as { count: number };
    const treeNodes = db.prepare("SELECT count(*) AS count FROM tree_nodes").get() as { count: number };
    return { cards: cards.count, treeNodes: treeNodes.count };
  } finally {
    db.close();
  }
}

it("rejects missing references before writing seed rows and can run again after correction", () => {
  writeSeed([
    {
      key: "main",
      title: "Main",
      card_type: "knowledge",
      content: "Body",
      references: ["missing"],
    },
  ]);

  const invalid = runSeed(["--file", seedPath]);

  expect(invalid.status).toBe(1);
  expect(invalid.stderr).toContain("Seed key not found: missing");
  expect(getSeedCounts()).toEqual({ cards: 0, treeNodes: 0 });

  writeSeed([
    {
      key: "main",
      title: "Main",
      card_type: "knowledge",
      content: "Body",
    },
  ]);
  const corrected = runSeed(["--file", seedPath]);

  expect(corrected.status).toBe(0);
  expect(corrected.stdout).toContain("Seeded 1 cards, 1 nodes");
  expect(getSeedCounts()).toEqual({ cards: 1, treeNodes: 1 });
});

it("deletes first-batch rows when the follow-up batch fails", async () => {
  const setup = new SqliteAdapter(sqlitePath);
  try {
    await setup.runMigrations(migrations);
  } finally {
    await setup.close();
  }
  const db = new Database(sqlitePath);
  try {
    db.exec(
      "CREATE TRIGGER fail_journal_limit_update BEFORE UPDATE OF journal_limit ON tree_nodes " +
        "BEGIN SELECT RAISE(ABORT, 'injected followup failure'); END;",
    );
  } finally {
    db.close();
  }
  writeSeed([
    {
      key: "main",
      title: "Main",
      card_type: "knowledge",
      content: "Body",
      journal_limit: 7,
    },
  ]);

  const result = runSeed(["--file", seedPath]);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("injected followup failure");
  expect(getSeedCounts()).toEqual({ cards: 0, treeNodes: 0 });
});

it("keeps the default demo seed at 54 cards and 58 nodes", () => {
  const result = runSeed([]);

  expect(result.status).toBe(0);
  expect(result.stdout).toContain("Seeded 54 cards, 58 nodes");
  expect(getSeedCounts()).toEqual({ cards: 54, treeNodes: 58 });
});
