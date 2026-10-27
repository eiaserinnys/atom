import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (process.env["DATABASE_URL"] !== undefined) {
  throw new Error(
    "Unset DATABASE_URL before running tests. Tests never use a real database; PostgreSQL integration tests use TEST_DATABASE_URL.",
  );
}

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "atom-jest-"));
process.env["SQLITE_PATH"] = path.join(tempDirectory, "atom.db");

process.once("exit", () => {
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});
