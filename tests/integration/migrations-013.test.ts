import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { getIntegrationTestPool, setupIntegrationTestDb } from "./integration-harness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DROP_MIGRATION = path.resolve(
  __dirname,
  "../../src/db/migrations/013_drop_unused_card_fields.sql"
);
setupIntegrationTestDb();

describe("migration 013 on PostgreSQL", () => {
  it("removes fields from an 011-era schema and remains safe to rerun", async () => {
    const db = getIntegrationTestPool();
    const statusType = "stale" + "ness_status";
    const retiredColumns = ["stale" + "ness", "source_" + "checksum", "source_" + "checked_at"];
    await db.query(`CREATE TYPE ${statusType} AS ENUM ('fresh', 'stale', 'unverified')`);
    await db.query(`ALTER TABLE cards ADD COLUMN ${retiredColumns[0]} ${statusType} NOT NULL DEFAULT 'unverified'`);
    await db.query(`ALTER TABLE cards ADD COLUMN ${retiredColumns[1]} TEXT`);
    await db.query(`ALTER TABLE cards ADD COLUMN ${retiredColumns[2]} TIMESTAMPTZ`);

    const migration = fs.readFileSync(DROP_MIGRATION, "utf-8");
    await db.query(migration);
    await db.query(migration);

    const columns = await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'cards'`
    );
    const names = columns.rows.map((row) => row["column_name"] as string);
    expect(names).not.toEqual(expect.arrayContaining([
      "stale" + "ness",
      "source_" + "checksum",
      "source_" + "checked_at",
    ]));
    expect(names).toContain("source_snapshot");

    const types = await db.query(
      `SELECT typname FROM pg_type WHERE typname = $1`,
      [statusType]
    );
    expect(types.rows).toHaveLength(0);
  });
});
