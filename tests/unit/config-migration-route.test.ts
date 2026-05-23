import Fastify from "fastify";
import type { DatabaseAdapter, Queryable } from "../../src/db/adapter.js";
import {
  createMigrateToPgHandler,
  type MigrationRouteDeps,
} from "../../src/api/routes/config.js";

const sqlitePath = "/tmp/atom-route-migration-test.db";
const deprecatedPath = sqlitePath + ".deprecated";

const fsAccessLog: string[] = [];
const operationLog: string[] = [];
const existingPaths = new Set<string>();
let sqliteRowsProvider: (sql: string) => Record<string, unknown>[] = () => [];

type FakeDb = DatabaseAdapter & {
  transactionCalls: number;
};

function makeFakeDb(
  dbType: "postgres" | "sqlite" = "postgres",
  txQuery: Queryable["query"] = async () => ({ rows: [], rowCount: 0, command: "", oid: 0, fields: [] }),
): FakeDb {
  const db = {
    dbType,
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

function makeDeps(db: DatabaseAdapter): MigrationRouteDeps {
  return {
    getDb: () => db,
    getSqlitePath: () => sqlitePath,
    existsSync: (target) => {
      fsAccessLog.push(target);
      return existingPaths.has(target);
    },
    openSqliteReadonly: (filename) => {
      operationLog.push(`sqlite.open:${filename}:readonly`);
      return {
        prepare: (sql) => {
          operationLog.push(`sqlite.prepare:${sql}`);
          return {
            all: () => {
              operationLog.push(`sqlite.all:${sql}`);
              return sqliteRowsProvider(sql);
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

async function injectMigrateToPg(db: DatabaseAdapter) {
  const app = Fastify({ logger: false });
  app.addHook("preHandler", async (req) => {
    req.jwtUser = {
      id: "test-admin",
      email: "admin@example.test",
      name: "Test Admin",
      role: "admin",
    };
  });
  app.post("/api/config/migrate-to-pg", createMigrateToPgHandler(makeDeps(db)));
  const response = await app.inject({
    method: "POST",
    url: "/api/config/migrate-to-pg",
  });
  await app.close();
  return response;
}

describe("POST /api/config/migrate-to-pg route safety harness", () => {
  beforeEach(() => {
    fsAccessLog.length = 0;
    operationLog.length = 0;
    existingPaths.clear();
    sqliteRowsProvider = () => [];
  });

  it("does not touch filesystem preconditions when current mode is not PostgreSQL", async () => {
    const response = await injectMigrateToPg(makeFakeDb("sqlite"));

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Current mode is not PostgreSQL. Switch to PostgreSQL first.",
    });
    expect(fsAccessLog).toEqual([]);
    expect(operationLog).toEqual([]);
  });

  it("does not check deprecated marker when the SQLite file is missing", async () => {
    const response = await injectMigrateToPg(makeFakeDb());

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: `SQLite file not found: ${sqlitePath}`,
    });
    expect(fsAccessLog).toEqual([sqlitePath]);
    expect(operationLog).toEqual([]);
  });

  it("checks deprecated marker only after confirming the SQLite file exists", async () => {
    existingPaths.add(sqlitePath);
    existingPaths.add(deprecatedPath);

    const response = await injectMigrateToPg(makeFakeDb());

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Migration already completed (.deprecated file exists).",
    });
    expect(fsAccessLog).toEqual([sqlitePath, deprecatedPath]);
    expect(operationLog).toEqual([]);
  });

  it("opens SQLite read-only, commits before close, and renames after close on success", async () => {
    existingPaths.add(sqlitePath);
    const db = makeFakeDb();

    const response = await injectMigrateToPg(db);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      message: "Migration completed. SQLite file renamed to .deprecated.",
    });
    expect(fsAccessLog).toEqual([sqlitePath, deprecatedPath]);
    expect(db.transactionCalls).toBe(1);
    expect(operationLog).toEqual([
      `sqlite.open:${sqlitePath}:readonly`,
      "pg.begin",
      "sqlite.prepare:SELECT * FROM users ORDER BY created_at",
      "sqlite.all:SELECT * FROM users ORDER BY created_at",
      "sqlite.prepare:SELECT * FROM agents ORDER BY created_at",
      "sqlite.all:SELECT * FROM agents ORDER BY created_at",
      "sqlite.prepare:SELECT * FROM cards ORDER BY card_timestamp",
      "sqlite.all:SELECT * FROM cards ORDER BY card_timestamp",
      "sqlite.prepare:SELECT * FROM tree_nodes ORDER BY created_at",
      "sqlite.all:SELECT * FROM tree_nodes ORDER BY created_at",
      "pg.commit",
      "sqlite.close",
      `fs.rename:${sqlitePath}:${deprecatedPath}`,
    ]);
  });

  it("rolls back, closes SQLite, and preserves the existing failure response shape", async () => {
    existingPaths.add(sqlitePath);
    sqliteRowsProvider = (sql) => {
      if (sql === "SELECT * FROM users ORDER BY created_at") {
        return [
          {
            id: "user-1",
            email: "admin@example.test",
            role: "admin",
            is_active: 1,
            created_at: "2026-05-24T00:00:00.000Z",
          },
        ];
      }
      return [];
    };
    const txQuery: Queryable["query"] = async () => {
      operationLog.push("pg.query");
      throw new Error("copy failed");
    };

    const response = await injectMigrateToPg(makeFakeDb("postgres", txQuery));

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: "Migration failed: copy failed",
    });
    expect(operationLog).toContain("pg.rollback");
    expect(operationLog).toContain("sqlite.close");
    expect(operationLog).not.toContain(`fs.rename:${sqlitePath}:${deprecatedPath}`);
    expect(operationLog.indexOf("pg.rollback")).toBeLessThan(operationLog.indexOf("sqlite.close"));
  });
});
