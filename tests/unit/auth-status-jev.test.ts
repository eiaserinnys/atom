import { buildBypassAuthStatus } from "../../src/api/routes/auth_helpers.js";
import { isJevConfigured } from "../../src/services/jev-search/config.js";
import { makeAuthApp, restoreAuthEnv, restoreAuthGlobals } from "./auth-route-test-utils.js";

const SECRET = "typesafe-secret-value";
const BASE_URL = "https://jev.example.test";

async function bypassStatus() {
  process.env["AUTH_BYPASS"] = "1";
  const app = await makeAuthApp();
  const response = await app.inject({ method: "GET", url: "/api/auth/status" });
  await app.close();
  return response;
}

describe("GET /api/auth/status jevConfigured", () => {
  beforeEach(restoreAuthEnv);
  afterEach(restoreAuthGlobals);

  it("is false while the Jev key and address are not both set", async () => {
    expect((await bypassStatus()).json().jevConfigured).toBe(false);

    process.env["TYPESAFE_API_KEY"] = SECRET;
    expect((await bypassStatus()).json().jevConfigured).toBe(false);

    delete process.env["TYPESAFE_API_KEY"];
    process.env["TYPESAFE_BASE_URL"] = BASE_URL;
    expect((await bypassStatus()).json().jevConfigured).toBe(false);
  });

  it("is false for an address Jev search itself would reject", async () => {
    process.env["TYPESAFE_API_KEY"] = SECRET;
    process.env["TYPESAFE_BASE_URL"] = "ftp://jev.example.test";
    expect((await bypassStatus()).json().jevConfigured).toBe(false);
  });

  it("is true in the bypass branch once both are set, without exposing them", async () => {
    process.env["TYPESAFE_API_KEY"] = SECRET;
    process.env["TYPESAFE_BASE_URL"] = BASE_URL;
    const response = await bypassStatus();

    expect(response.json()).toEqual(buildBypassAuthStatus(true));
    expect(response.body).not.toContain(SECRET);
    expect(response.body).not.toContain(BASE_URL);
  });

  it("follows the environment on every request, not once at startup", async () => {
    process.env["AUTH_BYPASS"] = "1";
    const app = await makeAuthApp();
    const read = async () => (await app.inject({ method: "GET", url: "/api/auth/status" })).json().jevConfigured;

    expect(await read()).toBe(false);
    process.env["TYPESAFE_API_KEY"] = SECRET;
    process.env["TYPESAFE_BASE_URL"] = BASE_URL;
    expect(await read()).toBe(true);
    await app.close();
  });

  it("matches the check Jev search uses", () => {
    expect(isJevConfigured({})).toBe(false);
    expect(isJevConfigured({ TYPESAFE_API_KEY: " ", TYPESAFE_BASE_URL: BASE_URL })).toBe(false);
    expect(isJevConfigured({ TYPESAFE_API_KEY: SECRET, TYPESAFE_BASE_URL: BASE_URL })).toBe(true);
  });
});
