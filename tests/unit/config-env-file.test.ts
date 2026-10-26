import {
  parseConfigEnvContent,
  updateConfigEnvContent,
} from "../../src/api/config/env-file.js";

describe("config env file helpers", () => {
  it("returns only allowlisted values in plain text", () => {
    expect(
      parseConfigEnvContent([
        "# comment",
        "API_PORT=3000",
        "GOOGLE_CLIENT_SECRET=shh",
        "EMPTY_TOKEN=",
        "PASSWORD_HINT = visible",
        "DATABASE_URL=postgresql://user:secret@localhost/atom",
        "TYPESAFE_API_KEY=jev-secret",
        "SEARCH_MOTION_PAGE_URL=https://pages.example/d/atom-search-motion",
        "INVALID_LINE",
        "COMPLEX=a=b",
      ].join("\n"))
    ).toEqual({
      API_PORT: "3000",
      GOOGLE_CLIENT_SECRET: "***",
      EMPTY_TOKEN: "",
      PASSWORD_HINT: "***",
      DATABASE_URL: "***",
      TYPESAFE_API_KEY: "***",
      SEARCH_MOTION_PAGE_URL: "https://pages.example/d/atom-search-motion",
      COMPLEX: "***",
    });
  });

  it("updates existing keys while preserving comments and order", () => {
    const content = [
      "# atom config",
      "API_PORT=3000",
      "",
      "GOOGLE_CLIENT_SECRET=old-secret",
      "ALLOWED_EMAIL=old@example.com",
      "NEW_SECRET=old-value",
    ].join("\n");

    expect(
      updateConfigEnvContent(content, [
        { key: "API_PORT", value: "4000" },
        { key: "GOOGLE_CLIENT_SECRET", value: "***" },
        { key: "NEW_SECRET", value: "***" },
        { key: "NEW_KEY", value: "new-value" },
      ])
    ).toBe([
      "# atom config",
      "API_PORT=4000",
      "",
      "GOOGLE_CLIENT_SECRET=old-secret",
      "ALLOWED_EMAIL=old@example.com",
      "NEW_SECRET=old-value",
      "NEW_KEY=new-value",
    ].join("\n"));
  });

  it("skips new masked values outside the allowlist and appends allowlisted keys", () => {
    expect(
      updateConfigEnvContent("", [
        { key: "GOOGLE_CLIENT_SECRET", value: "***" },
        { key: "ALLOWED_EMAIL", value: "owner@example.com" },
        { key: "UNLISTED_KEY", value: "***" },
      ])
    ).toBe("\nALLOWED_EMAIL=owner@example.com");
  });

  it("omits the DB-owned OpenAI key and refuses writes through the legacy env route", () => {
    const content = "API_PORT=3000\nOPENAI_API_KEY=test-value\nGOOGLE_CLIENT_SECRET=secret";
    const parsed = parseConfigEnvContent(content);
    expect(Object.keys(parsed)).toEqual(["API_PORT", "GOOGLE_CLIENT_SECRET"]);
    expect(JSON.stringify(parsed).includes("test-value")).toBe(false);
    expect(() => updateConfigEnvContent(content, [
      { key: "openai_api_key", value: "test-value" },
    ])).toThrow("OPENAI_KEY_DB_ONLY");
  });
});
