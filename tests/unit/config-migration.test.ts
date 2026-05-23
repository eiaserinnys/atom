import {
  getMigrationPreconditionError,
  parseSqliteJsonArrayField,
  toMigrationPositionKey,
} from "../../src/api/config/migration.js";

describe("config migration helpers — preconditions", () => {
  it("returns the existing error when current mode is not PostgreSQL", () => {
    expect(
      getMigrationPreconditionError({
        dbType: "sqlite",
        sqlitePath: "/tmp/atom.db",
        sqliteFileExists: true,
        deprecatedFileExists: false,
      })
    ).toBe("Current mode is not PostgreSQL. Switch to PostgreSQL first.");
  });

  it("returns the existing error when the SQLite file is missing", () => {
    expect(
      getMigrationPreconditionError({
        dbType: "postgres",
        sqlitePath: "/tmp/missing.db",
        sqliteFileExists: false,
        deprecatedFileExists: false,
      })
    ).toBe("SQLite file not found: /tmp/missing.db");
  });

  it("returns the existing error when the deprecated marker already exists", () => {
    expect(
      getMigrationPreconditionError({
        dbType: "postgres",
        sqlitePath: "/tmp/atom.db",
        sqliteFileExists: true,
        deprecatedFileExists: true,
      })
    ).toBe("Migration already completed (.deprecated file exists).");
  });

  it("returns null when migration can proceed", () => {
    expect(
      getMigrationPreconditionError({
        dbType: "postgres",
        sqlitePath: "/tmp/atom.db",
        sqliteFileExists: true,
        deprecatedFileExists: false,
      })
    ).toBeNull();
  });
});

describe("config migration helpers — legacy tree position", () => {
  it("converts legacy numeric positions with posToKey", () => {
    expect(toMigrationPositionKey(100)).toBe("0000000100");
  });

  it("keeps existing string positions unchanged", () => {
    const existing = "0000000200";
    expect(toMigrationPositionKey(existing)).toBe(existing);
  });
});

describe("config migration helpers — SQLite JSON array fields", () => {
  it("parses JSON string values", () => {
    expect(parseSqliteJsonArrayField('["a","b"]')).toEqual(["a", "b"]);
  });

  it("keeps existing array values unchanged", () => {
    const existing = ["alpha", "beta"];
    expect(parseSqliteJsonArrayField(existing)).toBe(existing);
  });

  it("falls back to an empty array for null-ish values", () => {
    expect(parseSqliteJsonArrayField(null)).toEqual([]);
    expect(parseSqliteJsonArrayField(undefined)).toEqual([]);
  });
});
