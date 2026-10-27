import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const invalidDatabaseUrl = "postgresql://invalid:invalid@127.0.0.1:1/forbidden_test_db";

function loadSetup(databaseUrl?: string, sqlitePath?: string) {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.SQLITE_PATH;
  if (databaseUrl !== undefined) env.DATABASE_URL = databaseUrl;
  if (sqlitePath !== undefined) env.SQLITE_PATH = sqlitePath;

  return spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      "await import('./tests/setup/isolate-db.ts'); console.log(JSON.stringify(process.env.SQLITE_PATH));",
    ],
    { cwd: process.cwd(), env, encoding: "utf8", timeout: 120_000 },
  );
}

test("Jest database setup rejects DATABASE_URL and isolates its default SQLite path", () => {
  const sqlitePath = process.env["SQLITE_PATH"];
  expect(sqlitePath).toBeDefined();
  expect(path.dirname(sqlitePath ?? "")).toBe(os.tmpdir());
  expect(path.basename(sqlitePath ?? "")).toMatch(/^atom-jest-\d+-[0-9a-f-]+\.db$/);

  const shellSqlitePath = path.join(os.tmpdir(), "shell-supplied-atom.db");
  const isolated = loadSetup(undefined, shellSqlitePath);
  expect(isolated.error).toBeUndefined();
  expect(isolated.status).toBe(0);
  const childSqlitePath = JSON.parse(isolated.stdout.trim()) as string;
  expect(childSqlitePath).not.toBe(shellSqlitePath);
  expect(path.dirname(childSqlitePath)).toBe(os.tmpdir());
  expect(path.basename(childSqlitePath)).toMatch(/^atom-jest-\d+-[0-9a-f-]+\.db$/);

  const rejected = loadSetup(invalidDatabaseUrl, shellSqlitePath);
  expect(rejected.error).toBeUndefined();
  expect(rejected.status).not.toBe(0);
  expect(rejected.stderr).toContain("Unset DATABASE_URL before running tests");
}, 130_000);
