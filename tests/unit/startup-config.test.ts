import { inspectStartupConfig } from "../../src/api/startup-config.js";

describe("startup configuration", () => {
  it("requires all auth values for each configured provider", () => {
    const result = inspectStartupConfig({
      GOOGLE_CLIENT_ID: "google-client",
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("JWT_SECRET");
    expect(result.errors[0]).toContain("FRONTEND_URL");
    expect(result.errors[0]).toContain("GOOGLE_CLIENT_SECRET");
    expect(result.errors[0]).toContain("GOOGLE_CALLBACK_URL");
    expect(result.errors[0]).not.toContain("SLACK_CLIENT_SECRET");
  });

  it("rejects bypass when an OAuth provider is configured", () => {
    const result = inspectStartupConfig({
      AUTH_BYPASS: "1",
      GOOGLE_CLIENT_ID: "google-client",
      JWT_SECRET: "jwt-secret",
      FRONTEND_URL: "https://dashboard.example",
      GOOGLE_CLIENT_SECRET: "google-secret",
      GOOGLE_CALLBACK_URL: "https://atom.example/api/auth/google/callback",
    });

    expect(result.errors.join(" ")).toContain("AUTH_BYPASS");
    expect(result.warning).toBeUndefined();
  });

  it("warns when neither OAuth nor explicit local bypass is configured", () => {
    const result = inspectStartupConfig({});

    expect(result.errors).toEqual([]);
    expect(result.warning).toContain("AUTH_BYPASS=1");
    expect(result.warning).toContain("401");
  });

  it("accepts explicit bypass when no provider is configured", () => {
    expect(inspectStartupConfig({ AUTH_BYPASS: "1" })).toEqual({
      errors: [],
      warning: undefined,
    });
  });
});
