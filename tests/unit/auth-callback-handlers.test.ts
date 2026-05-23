import { JWT_COOKIE_NAME, STATE_COOKIE_NAME } from "../../src/api/routes/auth_helpers.js";
import {
  configureGoogleCallbackEnv,
  configureSlackCallbackEnv,
  expectJwtCookiePayload,
  findSetCookieHeader,
  googleTokenResponse,
  googleUserinfoResponse,
  jsonResponse,
  makeFakeAuthDeps,
  makeInjectedAuthApp,
  makeUser,
  restoreAuthEnv,
  restoreAuthGlobals,
  slackIdentityResponse,
  slackTokenResponse,
} from "./auth-route-test-utils.js";

describe("auth callback handlers", () => {
  beforeEach(() => {
    restoreAuthEnv();
  });

  afterEach(() => {
    restoreAuthGlobals();
  });

  it("GET /api/auth/google/callback redirects token_exchange without real network or db", async () => {
    configureGoogleCallbackEnv();
    const harness = makeFakeAuthDeps({
      fetchResponses: [jsonResponse(false, { error: "invalid_grant" })],
    });
    const app = await makeInjectedAuthApp(harness.deps);

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/google/callback?code=code-1&state=state-1",
      headers: { cookie: `${STATE_COOKIE_NAME}=state-1` },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/?auth_error=token_exchange");
    expect(harness.fetchCalls.map((call) => call.url)).toEqual(["https://oauth2.googleapis.com/token"]);
    expect(harness.findCalls).toEqual([]);
    expect(harness.inserts).toEqual([]);
    await app.close();
  });

  it("GET /api/auth/google/callback redirects userinfo when the userinfo fetch fails", async () => {
    configureGoogleCallbackEnv();
    process.env["FRONTEND_URL"] = "https://dashboard.example";
    const harness = makeFakeAuthDeps({
      fetchResponses: [
        googleTokenResponse("google-access"),
        jsonResponse(false, { error: "userinfo_failed" }),
      ],
    });
    const app = await makeInjectedAuthApp(harness.deps);

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/google/callback?code=code-1&state=state-1",
      headers: { cookie: `${STATE_COOKIE_NAME}=state-1` },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://dashboard.example/?auth_error=userinfo");
    expect(harness.fetchCalls.map((call) => call.url)).toEqual([
      "https://oauth2.googleapis.com/token",
      "https://www.googleapis.com/oauth2/v2/userinfo",
    ]);
    expect(harness.findCalls).toEqual([]);
    expect(harness.inserts).toEqual([]);
    await app.close();
  });

  it("GET /api/auth/google/callback redirects unauthorized when ALLOWED_EMAIL rejects a new user", async () => {
    configureGoogleCallbackEnv();
    process.env["FRONTEND_URL"] = "https://dashboard.example";
    process.env["ALLOWED_EMAIL"] = "@allowed.example";
    const harness = makeFakeAuthDeps({
      fetchResponses: [
        googleTokenResponse("google-access"),
        googleUserinfoResponse("blocked@example.com", "Blocked User"),
      ],
    });
    const app = await makeInjectedAuthApp(harness.deps);

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/google/callback?code=code-1&state=state-1",
      headers: { cookie: `${STATE_COOKIE_NAME}=state-1` },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://dashboard.example/?auth_error=unauthorized");
    expect(harness.findCalls).toEqual(["blocked@example.com"]);
    expect(harness.inserts).toEqual([]);
    await app.close();
  });

  it("GET /api/auth/google/callback redirects deactivated for inactive existing users", async () => {
    configureGoogleCallbackEnv();
    process.env["FRONTEND_URL"] = "https://dashboard.example";
    const inactiveUser = makeUser({
      id: "inactive-google-user",
      email: "inactive@example.com",
      name: "Inactive User",
      role: "viewer",
      isActive: false,
    });
    const harness = makeFakeAuthDeps({
      users: { "inactive@example.com": inactiveUser },
      fetchResponses: [
        googleTokenResponse("google-access"),
        googleUserinfoResponse("inactive@example.com", "Inactive User"),
      ],
    });
    const app = await makeInjectedAuthApp(harness.deps);

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/google/callback?code=code-1&state=state-1",
      headers: { cookie: `${STATE_COOKIE_NAME}=state-1` },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://dashboard.example/?auth_error=deactivated");
    expect(harness.findCalls).toEqual(["inactive@example.com"]);
    expect(harness.inserts).toEqual([]);
    await app.close();
  });

  it("GET /api/auth/google/callback auto-creates allowed new users as editor and sets the JWT cookie", async () => {
    configureGoogleCallbackEnv();
    process.env["FRONTEND_URL"] = "https://dashboard.example";
    process.env["ALLOWED_EMAIL"] = "@example.com";
    const harness = makeFakeAuthDeps({
      fetchResponses: [
        googleTokenResponse("google-access"),
        googleUserinfoResponse("new@example.com", "New Google User"),
      ],
    });
    const app = await makeInjectedAuthApp(harness.deps);

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/google/callback?code=code-1&state=state-1",
      headers: { cookie: `${STATE_COOKIE_NAME}=state-1` },
    });
    const setCookie = findSetCookieHeader(response.headers["set-cookie"], JWT_COOKIE_NAME);

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://dashboard.example");
    expect(setCookie).toContain(`${JWT_COOKIE_NAME}=`);
    expect(setCookie).toContain("Path=/");
    expect(harness.findCalls).toEqual(["new@example.com"]);
    expect(harness.inserts).toEqual([{ email: "new@example.com", display_name: "New Google User", role: "editor" }]);
    await expectJwtCookiePayload(setCookie, {
      id: "inserted-1",
      email: "new@example.com",
      name: "New Google User",
      role: "editor",
    });
    await app.close();
  });

  it("GET /api/auth/slack/callback redirects token_exchange without real network or db", async () => {
    configureSlackCallbackEnv();
    process.env["FRONTEND_URL"] = "https://dashboard.example";
    const harness = makeFakeAuthDeps({
      fetchResponses: [jsonResponse(false, { ok: false, error: "bad_code" })],
    });
    const app = await makeInjectedAuthApp(harness.deps);

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/slack/callback?code=code-1&state=state-1",
      headers: { cookie: `${STATE_COOKIE_NAME}=state-1` },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://dashboard.example/?auth_error=token_exchange");
    expect(harness.fetchCalls.map((call) => call.url)).toEqual(["https://slack.com/api/oauth.v2.access"]);
    expect(harness.findCalls).toEqual([]);
    expect(harness.inserts).toEqual([]);
    await app.close();
  });

  it("GET /api/auth/slack/callback redirects userinfo when identity fetch fails", async () => {
    configureSlackCallbackEnv();
    process.env["FRONTEND_URL"] = "https://dashboard.example";
    const harness = makeFakeAuthDeps({
      fetchResponses: [
        slackTokenResponse("slack-access"),
        slackIdentityResponse({ email: "slack@example.com", name: "Slack User", ok: false, responseOk: false }),
      ],
    });
    const app = await makeInjectedAuthApp(harness.deps);

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/slack/callback?code=code-1&state=state-1",
      headers: { cookie: `${STATE_COOKIE_NAME}=state-1` },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://dashboard.example/?auth_error=userinfo");
    expect(harness.fetchCalls.map((call) => call.url)).toEqual([
      "https://slack.com/api/oauth.v2.access",
      "https://slack.com/api/users.identity",
    ]);
    expect(harness.findCalls).toEqual([]);
    expect(harness.inserts).toEqual([]);
    await app.close();
  });

  it("GET /api/auth/slack/callback redirects unauthorized_workspace before db lookup on workspace mismatch", async () => {
    configureSlackCallbackEnv();
    process.env["FRONTEND_URL"] = "https://dashboard.example";
    process.env["SLACK_ALLOWED_TEAM_ID"] = "T_ALLOWED";
    const harness = makeFakeAuthDeps({
      fetchResponses: [
        slackTokenResponse("slack-access"),
        slackIdentityResponse({ email: "slack@example.com", name: "Slack User", teamId: "T_OTHER" }),
      ],
    });
    const app = await makeInjectedAuthApp(harness.deps);

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/slack/callback?code=code-1&state=state-1",
      headers: { cookie: `${STATE_COOKIE_NAME}=state-1` },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://dashboard.example/?auth_error=unauthorized_workspace");
    expect(harness.findCalls).toEqual([]);
    expect(harness.inserts).toEqual([]);
    await app.close();
  });

  it("GET /api/auth/slack/callback redirects deactivated for inactive existing users", async () => {
    configureSlackCallbackEnv();
    process.env["FRONTEND_URL"] = "https://dashboard.example";
    const inactiveUser = makeUser({
      id: "inactive-slack-user",
      email: "inactive-slack@example.com",
      name: "Inactive Slack",
      role: "viewer",
      isActive: false,
    });
    const harness = makeFakeAuthDeps({
      users: { "inactive-slack@example.com": inactiveUser },
      fetchResponses: [
        slackTokenResponse("slack-access"),
        slackIdentityResponse({ email: "inactive-slack@example.com", name: "Inactive Slack" }),
      ],
    });
    const app = await makeInjectedAuthApp(harness.deps);

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/slack/callback?code=code-1&state=state-1",
      headers: { cookie: `${STATE_COOKIE_NAME}=state-1` },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://dashboard.example/?auth_error=deactivated");
    expect(harness.findCalls).toEqual(["inactive-slack@example.com"]);
    expect(harness.inserts).toEqual([]);
    await app.close();
  });

  it("GET /api/auth/slack/callback auto-creates new users as editor without ALLOWED_EMAIL and sets the JWT cookie", async () => {
    configureSlackCallbackEnv();
    process.env["FRONTEND_URL"] = "https://dashboard.example";
    delete process.env["ALLOWED_EMAIL"];
    const harness = makeFakeAuthDeps({
      fetchResponses: [
        slackTokenResponse("slack-access"),
        slackIdentityResponse({ email: "new-slack@example.com", name: "New Slack User" }),
      ],
    });
    const app = await makeInjectedAuthApp(harness.deps);

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/slack/callback?code=code-1&state=state-1",
      headers: { cookie: `${STATE_COOKIE_NAME}=state-1` },
    });
    const setCookie = findSetCookieHeader(response.headers["set-cookie"], JWT_COOKIE_NAME);

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://dashboard.example");
    expect(setCookie).toContain(`${JWT_COOKIE_NAME}=`);
    expect(harness.findCalls).toEqual(["new-slack@example.com"]);
    expect(harness.inserts).toEqual([{ email: "new-slack@example.com", display_name: "New Slack User", role: "editor" }]);
    await expectJwtCookiePayload(setCookie, {
      id: "inserted-1",
      email: "new-slack@example.com",
      name: "New Slack User",
      role: "editor",
    });
    await app.close();
  });
});
