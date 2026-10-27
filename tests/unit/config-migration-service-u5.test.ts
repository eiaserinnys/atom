import type { DatabaseAdapter, Queryable } from "../../src/db/adapter.js";
import {
  migrateSqliteToPostgres,
  type ConfigMigrationServiceDeps,
} from "../../src/api/config/migration-service.js";

const sqlitePath = "/tmp/atom-u5-migration-unit.db";
const deprecatedPath = sqlitePath + ".deprecated";
const selectSql = {
  users: "SELECT * FROM users ORDER BY created_at",
  agents: "SELECT * FROM agents ORDER BY created_at",
  cards: "SELECT * FROM cards ORDER BY card_timestamp",
  tree_nodes: "SELECT * FROM tree_nodes ORDER BY created_at",
};

type FakeDb = DatabaseAdapter & { transactionCalls: number };
type InsertCall = { table: string; values: unknown[] | undefined };

const operationLog: string[] = [];
const insertCalls: InsertCall[] = [];
let rowsBySql: Record<string, Record<string, unknown>[]> = {};
let checkpointBusy = 0;
let backupCountOverrides: Record<string, number> = {};

function makeFakeDb(txQuery: Queryable["query"] = async () => ({
  rows: [], rowCount: 0, command: "", oid: 0, fields: [],
})): FakeDb {
  const db = {
    dbType: "postgres",
    transactionCalls: 0,
    async query() {
      return { rows: [], rowCount: 0, command: "", oid: 0, fields: [] };
    },
    async transaction<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
      db.transactionCalls += 1;
      operationLog.push("pg.begin");
      try {
        const result = await fn({ query: txQuery });
        operationLog.push("pg.commit");
        return result;
      } catch (error) {
        operationLog.push("pg.rollback");
        throw error;
      }
    },
    async close() {},
    async runMigrations() {},
  } satisfies FakeDb;
  return db;
}

function makeDeps(db: DatabaseAdapter): ConfigMigrationServiceDeps {
  const deps = {
    db,
    getSqlitePath: () => sqlitePath,
    existsSync: (filename: string) => filename === sqlitePath,
    checkpointSqlite: (filename: string) => {
      operationLog.push(`sqlite.checkpoint:${filename}`);
      return { busy: checkpointBusy };
    },
    openSqliteReadonly: (filename: string) => {
      operationLog.push(`sqlite.open:${filename}:readonly`);
      return {
        prepare(sql: string) {
          operationLog.push(`sqlite.prepare:${sql}`);
          return {
            all() {
              operationLog.push(`sqlite.all:${sql}`);
              const countMatch = sql.match(/^SELECT COUNT\(\*\) AS count FROM ([a-z_]+)$/i);
              if (countMatch) {
                const table = countMatch[1];
                const actualCount = rowsBySql[selectSql[table as keyof typeof selectSql]]?.length ?? 0;
                return [{ count: backupCountOverrides[table] ?? actualCount }];
              }
              return rowsBySql[sql] ?? [];
            },
          };
        },
        close() {
          operationLog.push("sqlite.close");
        },
      };
    },
    renameSync: (from: string, to: string) => {
      operationLog.push(`fs.rename:${from}:${to}`);
    },
  };
  return deps as unknown as ConfigMigrationServiceDeps;
}

function treeNode(
  id: string,
  parentNodeId: string | null,
  journalLimit?: number | null,
  isSymlink = false,
): Record<string, unknown> {
  return {
    id,
    card_id: `card-${id}`,
    parent_node_id: parentNodeId,
    position: 1,
    is_symlink: isSymlink ? 1 : 0,
    created_at: "2026-05-24T00:00:00.000Z",
    ...(journalLimit === undefined ? {} : { journal_limit: journalLimit }),
  };
}

describe("U5 SQLite-to-PostgreSQL migration regressions", () => {
  beforeEach(() => {
    operationLog.length = 0;
    insertCalls.length = 0;
    rowsBySql = {};
    checkpointBusy = 0;
    backupCountOverrides = {};
  });

  it("rejects a rootless cycle and an orphan before opening a PostgreSQL transaction", async () => {
    rowsBySql[selectSql.tree_nodes] = [
      treeNode("root", null),
      treeNode("cycle-a", "cycle-b"),
      treeNode("cycle-b", "cycle-a"),
      treeNode("orphan", "missing-parent"),
    ];
    const db = makeFakeDb();

    const result = await migrateSqliteToPostgres(makeDeps(db));

    expect(result).toMatchObject({ ok: false, statusCode: 400 });
    if (!result.ok) {
      expect(result.error).toContain("3");
      expect(result.error).toContain("cycle-a");
      expect(result.error).toContain("cycle-b");
      expect(result.error).toContain("orphan");
    }
    expect(db.transactionCalls).toBe(0);
    expect(operationLog).toContain("sqlite.close");
    expect(operationLog).not.toContain(`fs.rename:${sqlitePath}:${deprecatedPath}`);
  });

  it("copies every node when the source has multiple roots", async () => {
    rowsBySql[selectSql.tree_nodes] = [
      treeNode("root-a", null),
      treeNode("root-b", null),
      treeNode("child-b", "root-b"),
    ];
    const db = makeFakeDb(async (queryText, values) => {
      if (queryText.startsWith("SELECT id FROM users")) {
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }
      insertCalls.push({ table: "tree_nodes", values });
      return { rows: [], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
    });

    const result = await migrateSqliteToPostgres(makeDeps(db));

    expect(result).toEqual({ ok: true });
    expect(insertCalls.map((call) => call.values?.[0])).toEqual(["root-a", "root-b", "child-b"]);
    expect(db.transactionCalls).toBe(1);
  });

  it("returns 409 without reading or copying when the SQLite checkpoint is busy", async () => {
    checkpointBusy = 1;
    const db = makeFakeDb();

    const result = await migrateSqliteToPostgres(makeDeps(db));

    expect(result).toMatchObject({ ok: false, statusCode: 409 });
    if (!result.ok) expect(result.error).toContain("in use");
    expect(operationLog[0]).toBe(`sqlite.checkpoint:${sqlitePath}`);
    expect(operationLog.some((entry) => entry.startsWith("sqlite.open:"))).toBe(false);
    expect(db.transactionCalls).toBe(0);
    expect(operationLog.some((entry) => entry.startsWith("fs.rename:"))).toBe(false);
  });

  it("copies journal_limit values for ordinary and symlink nodes and maps a legacy missing column to null", async () => {
    rowsBySql[selectSql.tree_nodes] = [
      treeNode("none", null, null),
      treeNode("unlimited", null, 0),
      treeNode("limited-alias", null, 7, true),
      treeNode("legacy", null),
    ];
    const db = makeFakeDb(async (queryText, values) => {
      if (queryText.startsWith("SELECT id FROM users")) {
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      }
      if (queryText.startsWith("INSERT INTO tree_nodes")) {
        insertCalls.push({ table: "tree_nodes", values });
      }
      return { rows: [], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
    });

    const result = await migrateSqliteToPostgres(makeDeps(db));

    expect(result).toEqual({ ok: true });
    expect(insertCalls.map((call) => [call.values?.[0], call.values?.[6]])).toEqual([
      ["none", null],
      ["unlimited", 0],
      ["limited-alias", 7],
      ["legacy", null],
    ]);
  });

  it("reports an incomplete backup after PostgreSQL has committed the copy", async () => {
    rowsBySql[selectSql.tree_nodes] = [treeNode("root", null)];
    backupCountOverrides.tree_nodes = 2;
    const db = makeFakeDb();

    const result = await migrateSqliteToPostgres(makeDeps(db));

    expect(result).toMatchObject({ ok: false, statusCode: 500 });
    if (!result.ok) {
      expect(result.error).toContain("PostgreSQL copy completed");
      expect(result.error).toContain("backup is incomplete");
    }
    expect(operationLog).toContain("pg.commit");
    expect(operationLog).toContain(`fs.rename:${sqlitePath}:${deprecatedPath}`);
  });
});
