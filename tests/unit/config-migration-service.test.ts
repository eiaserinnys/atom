import type { DatabaseAdapter, Queryable } from "../../src/db/adapter.js";
import {
  migrateSqliteToPostgres,
  type ConfigMigrationServiceDeps,
} from "../../src/api/config/migration-service.js";

const sqlitePath = "/tmp/atom-service-migration-test.db";
const deprecatedPath = sqlitePath + ".deprecated";

type FakeDb = DatabaseAdapter & {
  transactionCalls: number;
};

type InsertCall = {
  table: string;
  values: unknown[] | undefined;
};

const operationLog: string[] = [];
const insertCalls: InsertCall[] = [];
let rowsBySql: Record<string, Record<string, unknown>[]> = {};

function tableFromInsert(queryText: string): string {
  const match = queryText.match(/INSERT INTO ([a-z_]+)/);
  if (!match) throw new Error(`Unexpected query: ${queryText}`);
  return match[1];
}

function makeFakeDb(txQuery: Queryable["query"] = async () => ({ rows: [], rowCount: 0, command: "", oid: 0, fields: [] })): FakeDb {
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
      } catch (err) {
        operationLog.push("pg.rollback");
        throw err;
      }
    },
    async close() {},
    async runMigrations() {},
  } satisfies FakeDb;
  return db;
}

function makeDeps(db: DatabaseAdapter): ConfigMigrationServiceDeps {
  return {
    db,
    getSqlitePath: () => sqlitePath,
    existsSync: (target) => target === sqlitePath,
    openSqliteReadonly: (filename) => {
      operationLog.push(`sqlite.open:${filename}:readonly`);
      return {
        prepare: (sql) => {
          operationLog.push(`sqlite.prepare:${sql}`);
          return {
            all: () => {
              operationLog.push(`sqlite.all:${sql}`);
              return rowsBySql[sql] ?? [];
            },
          };
        },
        close: () => {
          operationLog.push("sqlite.close");
        },
      };
    },
    renameSync: (from, to) => {
      operationLog.push(`fs.rename:${from}:${to}`);
    },
  };
}

describe("migrateSqliteToPostgres", () => {
  beforeEach(() => {
    operationLog.length = 0;
    insertCalls.length = 0;
    rowsBySql = {};
  });

  it("copies non-empty SQLite rows into PostgreSQL with parsing, key conversion, and BFS node order", async () => {
    rowsBySql = {
      "SELECT * FROM users ORDER BY created_at": [
        {
          id: "user-1",
          email: "admin@example.test",
          display_name: "Admin",
          role: "admin",
          is_active: 1,
          created_at: "2026-05-24T00:00:00.000Z",
        },
      ],
      "SELECT * FROM agents ORDER BY created_at": [
        {
          id: "agent-row-1",
          agent_id: "agent-1",
          secret_hash: "hash",
          display_name: "Agent One",
          is_active: 1,
          created_by: "user-1",
          created_at: "2026-05-24T00:01:00.000Z",
        },
      ],
      "SELECT * FROM cards ORDER BY card_timestamp": [
        {
          id: "card-parent",
          card_type: "knowledge",
          title: "Parent",
          content: "body",
          references: '["ref-1","ref-2"]',
          tags: '["tag-a","tag-b"]',
          card_timestamp: "2026-05-24T00:02:00.000Z",
          updated_at: "2026-05-24T00:03:00.000Z",
        },
        {
          id: "card-child",
          card_type: "knowledge",
          title: "Child",
          content: null,
          references: "[]",
          tags: "[]",
          card_timestamp: "2026-05-24T00:04:00.000Z",
          updated_at: "2026-05-24T00:05:00.000Z",
        },
      ],
      "SELECT * FROM tree_nodes ORDER BY created_at": [
        {
          id: "node-child",
          card_id: "card-child",
          parent_node_id: "node-parent",
          position: 20,
          is_symlink: 0,
          created_at: "2026-05-24T00:07:00.000Z",
        },
        {
          id: "node-parent",
          card_id: "card-parent",
          parent_node_id: null,
          position: 10,
          is_symlink: 0,
          created_at: "2026-05-24T00:08:00.000Z",
        },
      ],
    };

    const txQuery: Queryable["query"] = async (queryText, values) => {
      insertCalls.push({ table: tableFromInsert(queryText), values });
      return { rows: [], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
    };
    const db = makeFakeDb(txQuery);

    const result = await migrateSqliteToPostgres(makeDeps(db));

    expect(result).toEqual({ ok: true });
    expect(db.transactionCalls).toBe(1);
    expect(insertCalls.map((call) => call.table)).toEqual([
      "users",
      "agents",
      "cards",
      "cards",
      "tree_nodes",
      "tree_nodes",
    ]);
    expect(insertCalls[2].values?.[4]).toEqual(["ref-1", "ref-2"]);
    expect(insertCalls[2].values?.[5]).toEqual(["tag-a", "tag-b"]);
    expect(insertCalls[4].values?.[0]).toBe("node-parent");
    expect(insertCalls[4].values?.[3]).toBe("0000000010");
    expect(insertCalls[5].values?.[0]).toBe("node-child");
    expect(insertCalls[5].values?.[2]).toBe("node-parent");
    expect(insertCalls[5].values?.[3]).toBe("0000000020");
    expect(operationLog.slice(-3)).toEqual([
      "pg.commit",
      "sqlite.close",
      `fs.rename:${sqlitePath}:${deprecatedPath}`,
    ]);
  });
});
