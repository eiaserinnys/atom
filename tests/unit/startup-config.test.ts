import { inspectStartupConfig } from "../../src/api/startup-config.js";

const source = { envFile: "/srv/atom/atom.env", envFileFound: true };

describe("startup configuration", () => {
  it("requires all auth values for each configured provider", () => {
    const result = inspectStartupConfig({
      GOOGLE_CLIENT_ID: "google-client",
    }, source);

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
    }, source);

    expect(result.errors.join(" ")).toContain("AUTH_BYPASS");
    expect(result.warning).toBeUndefined();
  });

  it("refuses to start with no login method and names the env file, without any value", () => {
    const secretValues = { JWT_SECRET: "jwt-secret-value", FRONTEND_URL: "https://dashboard.example" };
    const result = inspectStartupConfig(secretValues, source);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("npm run setup");
    expect(result.errors[0]).toContain("DASHBOARD_ADMIN_PASSWORD");
    expect(result.errors[0]).toContain("AUTH_BYPASS=1");
    expect(result.errors[0]).toContain("/srv/atom/atom.env");
    expect(result.errors[0]).not.toContain("jwt-secret-value");
    expect(result.errors[0]).not.toContain("not found");
  });

  it("says so when the env file it read does not exist", () => {
    const result = inspectStartupConfig({}, { envFile: "/srv/atom/atom.env", envFileFound: false });

    expect(result.errors[0]).toContain("/srv/atom/atom.env (not found)");
  });

  it.each([
    ["a password", { DASHBOARD_ADMIN_PASSWORD: "an-admin-password", JWT_SECRET: "jwt-secret" }],
    ["local bypass", { AUTH_BYPASS: "1" }],
  ])("starts with %s", (_name, env) => {
    expect(inspectStartupConfig(env, source)).toEqual({ errors: [], warning: undefined });
  });

  it("starts in OAuth mode with the same complete settings as before, with no notice", () => {
    expect(inspectStartupConfig({
      GOOGLE_CLIENT_ID: "google-client",
      GOOGLE_CLIENT_SECRET: "google-secret",
      GOOGLE_CALLBACK_URL: "https://atom.example/api/auth/google/callback",
      FRONTEND_URL: "https://dashboard.example",
      JWT_SECRET: "jwt-secret",
    }, source)).toEqual({ errors: [], warning: undefined });
  });
});
