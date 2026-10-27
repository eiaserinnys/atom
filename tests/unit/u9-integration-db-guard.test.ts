import { assertSafeTestDatabaseUrl } from "../integration/integration-harness.js";

describe("U9 integration database URL guard", () => {
  it("rejects a URL with test only in its username, host, and query", () => {
    const unsafeUrl =
      "postgresql://test-user:u9-password-secret@test-db.example:55479/production?search=test";

    let message = "";
    try {
      assertSafeTestDatabaseUrl(unsafeUrl);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('database: "production"');
    expect(message).toContain('host: "test-db.example:55479"');
    expect(message).not.toContain("u9-password-secret");
    expect(message).not.toContain("search=test");
  });

  it.each([
    "postgresql://postgres:test@127.0.0.1:55479/atom_test",
    "postgresql://postgres:test@127.0.0.1:55479/ATOM_TEST_1",
  ])("accepts test database name %s", (databaseUrl) => {
    expect(() => assertSafeTestDatabaseUrl(databaseUrl)).not.toThrow();
  });

  it("rejects a URL without a database name", () => {
    expect(() =>
      assertSafeTestDatabaseUrl("postgresql://postgres:secret@127.0.0.1:55479")
    ).toThrow(/database: \"\(empty\)\"/);
  });

  it("does not expose credentials when the URL cannot be parsed", () => {
    let message = "";
    try {
      assertSafeTestDatabaseUrl("not-a-database-url-u9-password-secret");
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("database: unavailable");
    expect(message).toContain("host: unavailable");
    expect(message).not.toContain("u9-password-secret");
  });
});
