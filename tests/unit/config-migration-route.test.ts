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
let checkpointBusy = 0;

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
    checkpointSqlite: (filename) => {
      operationLog.push(`sqlite.checkpoint:${filename}`);
      return { busy: checkpointBusy };
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

async function injectMigrateToPg(db: DatabaseAdapter, logLines?: string[]) {
  const app = Fastify({ logger: logLines ? { level: "error", stream: { write: (line: string) => { logLines.push(line); } } } : false });
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
    checkpointBusy = 0;
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

  it("checkpoints before reading, commits before close, renames, and verifies the backup", async () => {
    existingPaths.add(sqlitePath);
    const db = makeFakeDb();

    const response = await injectMigrateToPg(db);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      message: "Migration completed. SQLite file renamed to .deprecated.",
    });
    expect(fsAccessLog).toEqual([
      sqlitePath,
      deprecatedPath,
      sqlitePath + "-wal",
      sqlitePath + "-shm",
    ]);
    expect(db.transactionCalls).toBe(1);
    expect(operationLog[0]).toBe(`sqlite.checkpoint:${sqlitePath}`);
    expect(operationLog.indexOf(`sqlite.open:${sqlitePath}:readonly`)).toBeGreaterThan(0);
    expect(operationLog.indexOf("pg.begin")).toBeGreaterThan(
      operationLog.indexOf("sqlite.all:SELECT * FROM tree_nodes ORDER BY created_at"),
    );
    expect(operationLog.indexOf("pg.commit")).toBeLessThan(operationLog.indexOf("sqlite.close"));
    expect(operationLog.indexOf("sqlite.close")).toBeLessThan(
      operationLog.indexOf(`fs.rename:${sqlitePath}:${deprecatedPath}`),
    );
    expect(operationLog.indexOf(`fs.rename:${sqlitePath}:${deprecatedPath}`)).toBeLessThan(
      operationLog.indexOf(`sqlite.open:${deprecatedPath}:readonly`),
    );
    expect(operationLog.filter((entry) => entry.startsWith("sqlite.all:SELECT COUNT(*)")).length).toBe(4);
  });

  it("logs the error text on the server when it answers 500, with the same text the caller gets", async () => {
    existingPaths.add(sqlitePath);
    const logLines: string[] = [];
    const db = makeFakeDb();
    const deps = makeDeps(db);
    deps.checkpointSqlite = () => { throw new Error("disk I/O error at /data/atom.db"); };
    const app = Fastify({ logger: { level: "error", stream: { write: (line: string) => { logLines.push(line); } } } });
    app.addHook("preHandler", async (req) => {
      req.jwtUser = { id: "test-admin", email: "admin@example.test", name: "Test Admin", role: "admin" };
    });
    app.post("/api/config/migrate-to-pg", createMigrateToPgHandler(deps));
    const response = await app.inject({ method: "POST", url: "/api/config/migrate-to-pg" });
    await app.close();

    expect(response.statusCode).toBe(500);
    expect(response.json().error).toBe("Migration failed: disk I/O error at /data/atom.db");
    const logged = logLines.map((line) => JSON.parse(line));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ level: 50, msg: "config migration to PostgreSQL failed", error: "Migration failed: disk I/O error at /data/atom.db" });
  });

  it("does not log a 4xx answer as an error", async () => {
    const logLines: string[] = [];
    const response = await injectMigrateToPg(makeFakeDb("sqlite"), logLines);

    expect(response.statusCode).toBe(400);
    expect(logLines).toEqual([]);
  });

  it("returns 409 before opening SQLite when its checkpoint is busy", async () => {
    existingPaths.add(sqlitePath);
    checkpointBusy = 1;
    const db = makeFakeDb();

    const response = await injectMigrateToPg(db);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: expect.stringContaining("in use") });
    expect(operationLog).toEqual([`sqlite.checkpoint:${sqlitePath}`]);
    expect(db.transactionCalls).toBe(0);
    expect(fsAccessLog).toEqual([sqlitePath, deprecatedPath]);
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
