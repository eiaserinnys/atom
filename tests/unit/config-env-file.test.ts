import {
  parseConfigEnvContent,
  updateConfigEnvContent,
} from "../../src/api/config/env-file.js";

describe("config env file helpers", () => {
  it("parses key-value lines and masks sensitive values", () => {
    expect(
      parseConfigEnvContent([
        "# comment",
        "API_PORT=3000",
        "GOOGLE_CLIENT_SECRET=shh",
        "EMPTY_TOKEN=",
        "PASSWORD_HINT = visible",
        "INVALID_LINE",
        "COMPLEX=a=b",
      ].join("\n"))
    ).toEqual({
      API_PORT: "3000",
      GOOGLE_CLIENT_SECRET: "***",
      EMPTY_TOKEN: "",
      PASSWORD_HINT: "***",
      COMPLEX: "a=b",
    });
  });

  it("updates existing keys while preserving comments and order", () => {
    const content = [
      "# atom config",
      "API_PORT=3000",
      "",
      "GOOGLE_CLIENT_SECRET=old-secret",
      "ALLOWED_EMAIL=old@example.com",
    ].join("\n");

    expect(
      updateConfigEnvContent(content, [
        { key: "API_PORT", value: "4000" },
        { key: "GOOGLE_CLIENT_SECRET", value: "***" },
        { key: "NEW_KEY", value: "new-value" },
      ])
    ).toBe([
      "# atom config",
      "API_PORT=4000",
      "",
      "GOOGLE_CLIENT_SECRET=old-secret",
      "ALLOWED_EMAIL=old@example.com",
      "NEW_KEY=new-value",
    ].join("\n"));
  });

  it("skips new masked sensitive values and appends non-sensitive keys for missing files", () => {
    expect(
      updateConfigEnvContent("", [
        { key: "GOOGLE_CLIENT_SECRET", value: "***" },
        { key: "ALLOWED_EMAIL", value: "owner@example.com" },
      ])
    ).toBe("\nALLOWED_EMAIL=owner@example.com");
  });
});
