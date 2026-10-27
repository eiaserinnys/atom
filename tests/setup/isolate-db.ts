import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

if (process.env["DATABASE_URL"] !== undefined) {
  throw new Error(
    "Unset DATABASE_URL before running tests. Tests never use a real database; PostgreSQL integration tests use TEST_DATABASE_URL.",
  );
}

process.env["SQLITE_PATH"] = path.join(
  os.tmpdir(),
  `atom-jest-${process.pid}-${randomUUID()}.db`,
);
