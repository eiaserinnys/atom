import { spawnSync } from "node:child_process";
import fs from "node:fs";
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
  const workspace = path.dirname(sqlitePath ?? "");
  expect(path.relative(os.tmpdir(), workspace).startsWith("..")).toBe(false);
  expect(path.basename(workspace)).toMatch(/^atom-jest-/);
  expect(path.basename(sqlitePath ?? "")).toBe("atom.db");

  const disposablePath = "/tmp/not-used-by-jest/atom.db";
  const isolated = loadSetup(undefined, disposablePath);
  expect(isolated.error).toBeUndefined();
  expect(isolated.status).toBe(0);
  const childSqlitePath = JSON.parse(isolated.stdout.trim()) as string;
  expect(childSqlitePath).not.toBe(disposablePath);
  expect(path.basename(path.dirname(childSqlitePath))).toMatch(/^atom-jest-/);
  expect(fs.existsSync(path.dirname(childSqlitePath))).toBe(false);

  const rejected = loadSetup(invalidDatabaseUrl, disposablePath);
  expect(rejected.error).toBeUndefined();
  expect(rejected.status).not.toBe(0);
  expect(rejected.stderr).toContain("Unset DATABASE_URL before running tests");
}, 130_000);
