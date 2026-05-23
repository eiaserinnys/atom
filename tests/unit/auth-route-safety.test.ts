import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { jwtVerify } from "jose";
import { authRoutes, createAuthRoutes, type AuthRoutesDeps } from "../../src/api/routes/auth.js";
import {
  JWT_COOKIE_NAME,
  JWT_EXPIRY_SECONDS,
  STATE_COOKIE_NAME,
  buildGoogleAuthRedirectUrl,
  buildSlackAuthRedirectUrl,
  buildBypassAuthStatus,
  getJwtCookieOptions,
  getProviderAvailability,
  getStateCookieOptions,
  isSlackWorkspaceAllowed,
} from "../../src/api/routes/auth_helpers.js";
import type { User } from "../../src/db/queries/users.js";

const savedEnv = { ...process.env };
const savedFetch = globalThis.fetch;

function restoreAuthEnv() {
  process.env = { ...savedEnv };
  delete process.env["GOOGLE_CLIENT_ID"];
  delete process.env["GOOGLE_CLIENT_SECRET"];
  delete process.env["GOOGLE_CALLBACK_URL"];
  delete process.env["SLACK_CLIENT_ID"];
  delete process.env["SLACK_CLIENT_SECRET"];
  delete process.env["SLACK_CALLBACK_URL"];
  delete process.env["SLACK_ALLOWED_TEAM_ID"];
  delete process.env["FRONTEND_URL"];
  process.env["JWT_SECRET"] = "test-secret-for-auth-route-safety";
}

async function makeAuthApp() {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(authRoutes);
  return app;
}

async function makeInjectedAuthApp(deps: AuthRoutesDeps) {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(createAuthRoutes(deps));
  return app;
}

function getSingleHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function getHeaderValues(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function extractCookieValue(setCookie: string, name: string): string {
  const match = setCookie.match(new RegExp(`${name}=([^;]+)`));
  if (!match) throw new Error(`Cookie not found: ${name}`);
  return match[1];
}

function findSetCookieHeader(value: string | string[] | undefined, name: string): string {
  const header = getHeaderValues(value).find((item) => item.startsWith(`${name}=`));
  if (!header) throw new Error(`Set-Cookie header not found: ${name}`);
  return header;
}

function jsonResponse(ok: boolean, body: unknown): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

function makeUser(input: {
  id?: string;
  email: string;
  name?: string;
  role?: User["role"];
  isActive?: boolean;
}): User {
  return {
    id: input.id ?? `user-${input.email}`,
    email: input.email,
    display_name: input.name ?? input.email,
    role: input.role ?? "editor",
    is_active: input.isActive ?? true,
    created_at: "2026-05-24T00:00:00.000Z",
  };
}

function makeFakeAuthDeps(input: {
  fetchResponses: Response[];
  users?: Record<string, User | undefined>;
}) {
  const db = { name: "fake-auth-db" } as unknown as ReturnType<AuthRoutesDeps["getDb"]>;
  const users = { ...(input.users ?? {}) };
  const fetchResponses = [...input.fetchResponses];
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  const findCalls: string[] = [];
  const inserts: Array<{ email: string; display_name?: string; role: User["role"] }> = [];

  const deps: AuthRoutesDeps = {
    fetch: (async (url, init) => {
      fetchCalls.push({ url: String(url), init });
      const response = fetchResponses.shift();
      if (!response) throw new Error(`Unexpected fetch: ${String(url)}`);
      return response;
    }) as typeof fetch,
    getDb: () => db,
    findUserByEmail: async (actualDb, email) => {
      expect(actualDb).toBe(db);
      findCalls.push(email);
      return users[email] ?? null;
    },
    insertUser: async (actualDb, insert) => {
      expect(actualDb).toBe(db);
      inserts.push(insert);
      const user = makeUser({
        id: `inserted-${inserts.length}`,
        email: insert.email,
        name: insert.display_name,
        role: insert.role,
      });
      users[insert.email] = user;
      return user;
    },
  };

  return { deps, fetchCalls, findCalls, inserts, users };
}

function configureGoogleCallbackEnv() {
  process.env["GOOGLE_CLIENT_ID"] = "google-client";
  process.env["GOOGLE_CLIENT_SECRET"] = "google-secret";
  process.env["GOOGLE_CALLBACK_URL"] = "https://atom.example/api/auth/google/callback";
}

function configureSlackCallbackEnv() {
  process.env["SLACK_CLIENT_ID"] = "slack-client";
  process.env["SLACK_CLIENT_SECRET"] = "slack-secret";
  process.env["SLACK_CALLBACK_URL"] = "https://atom.example/api/auth/slack/callback";
}

function googleTokenResponse(accessToken = "google-access") {
  return jsonResponse(true, { access_token: accessToken });
}

function googleUserinfoResponse(email: string, name: string, ok = true) {
  return jsonResponse(ok, { email, name });
}

function slackTokenResponse(accessToken = "slack-access", ok = true) {
  return jsonResponse(true, { ok, authed_user: ok ? { access_token: accessToken } : undefined, error: ok ? undefined : "bad_code" });
}

function slackIdentityResponse(input: {
  email: string;
  name: string;
  teamId?: string;
  teamName?: string;
  ok?: boolean;
  responseOk?: boolean;
}) {
  return jsonResponse(input.responseOk ?? true, {
    ok: input.ok ?? true,
    user: { id: "U123", name: input.name, email: input.email, image_192: "https://slack.example/u.png" },
    team: { id: input.teamId ?? "T_ALLOWED", name: input.teamName ?? "Allowed Team" },
    error: input.ok === false ? "identity_failed" : undefined,
  });
}

async function expectJwtCookiePayload(setCookie: string, expected: {
  id: string;
  email: string;
  name: string;
  role: User["role"];
}) {
  const jwtSecret = new TextEncoder().encode(process.env["JWT_SECRET"]!);
  const token = extractCookieValue(setCookie, JWT_COOKIE_NAME);
  const { payload } = await jwtVerify(token, jwtSecret);
  expect(payload["id"]).toBe(expected.id);
  expect(payload["email"]).toBe(expected.email);
  expect(payload["name"]).toBe(expected.name);
  expect(payload["role"]).toBe(expected.role);
}

describe("auth route safety boundaries", () => {
  beforeEach(() => {
    restoreAuthEnv();
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    globalThis.fetch = savedFetch;
  });

  it("builds the Google auth redirect URL with the existing parameter contract", () => {
    const url = new URL(
      buildGoogleAuthRedirectUrl({
        clientId: "google-client",
        callbackUrl: "https://atom.example/api/auth/google/callback",
        state: "state-123",
      }),
    );

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("google-client");
    expect(url.searchParams.get("redirect_uri")).toBe("https://atom.example/api/auth/google/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBe("state-123");
  });

  it("builds the Slack auth redirect URL with the existing parameter contract", () => {
    const url = new URL(
      buildSlackAuthRedirectUrl({
        clientId: "slack-client",
        callbackUrl: "https://atom.example/api/auth/slack/callback",
        state: "state-456",
      }),
    );

    expect(url.origin + url.pathname).toBe("https://slack.com/oauth/v2/authorize");
    expect(url.searchParams.get("client_id")).toBe("slack-client");
    expect(url.searchParams.get("redirect_uri")).toBe("https://atom.example/api/auth/slack/callback");
    expect(url.searchParams.get("user_scope")).toBe("identity.basic,identity.email,identity.avatar");
    expect(url.searchParams.get("state")).toBe("state-456");
  });

  it("keeps provider availability and bypass status response shapes stable", () => {
    expect(getProviderAvailability({ googleClientId: "google", slackClientId: undefined })).toEqual({
      google: true,
      slack: false,
    });
    expect(getProviderAvailability({ googleClientId: undefined, slackClientId: "slack" })).toEqual({
      google: false,
      slack: true,
    });
    expect(buildBypassAuthStatus()).toEqual({
      authenticated: true,
      id: "bypass",
      email: "bypass@local",
      name: "Bypass Admin",
      role: "admin",
    });
  });

  it("keeps Slack workspace policy explicit", () => {
    expect(isSlackWorkspaceAllowed("T_ALLOWED", undefined)).toBe(true);
    expect(isSlackWorkspaceAllowed("T_ALLOWED", "T_ALLOWED")).toBe(true);
    expect(isSlackWorkspaceAllowed("T_OTHER", "T_ALLOWED")).toBe(false);
  });

  it("keeps auth cookie names and options stable", () => {
    expect(JWT_COOKIE_NAME).toBe("atom_auth");
    expect(STATE_COOKIE_NAME).toBe("atom_oauth_state");
    expect(JWT_EXPIRY_SECONDS).toBe(7 * 24 * 60 * 60);
    expect(getStateCookieOptions()).toEqual({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 300,
    });
    expect(getJwtCookieOptions("development")).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: JWT_EXPIRY_SECONDS,
    });
    expect(getJwtCookieOptions("production").secure).toBe(true);
  });

  it("GET /api/auth/providers returns the existing provider availability body", async () => {
    process.env["GOOGLE_CLIENT_ID"] = "google-client";
    const app = await makeAuthApp();

    const response = await app.inject({ method: "GET", url: "/api/auth/providers" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ google: true, slack: false });
    await app.close();
  });

  it("GET /api/auth/status returns the existing bypass admin response when providers are absent", async () => {
    const app = await makeAuthApp();

    const response = await app.inject({ method: "GET", url: "/api/auth/status" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(buildBypassAuthStatus());
    await app.close();
  });

  it("GET /api/auth/google redirects with the existing query string and state cookie contract", async () => {
    process.env["GOOGLE_CLIENT_ID"] = "google-client";
    process.env["GOOGLE_CALLBACK_URL"] = "https://atom.example/api/auth/google/callback";
    const app = await makeAuthApp();

    const response = await app.inject({ method: "GET", url: "/api/auth/google" });
    const location = new URL(getSingleHeaderValue(response.headers.location));
    const setCookie = findSetCookieHeader(response.headers["set-cookie"], STATE_COOKIE_NAME);
    const stateCookie = extractCookieValue(setCookie, STATE_COOKIE_NAME);

    expect(response.statusCode).toBe(302);
    expect(location.origin + location.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(location.searchParams.get("client_id")).toBe("google-client");
    expect(location.searchParams.get("redirect_uri")).toBe("https://atom.example/api/auth/google/callback");
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(location.searchParams.get("scope")).toBe("openid email profile");
    expect(location.searchParams.get("state")).toBe(stateCookie);
    expect(setCookie).toContain(`${STATE_COOKIE_NAME}=`);
    expect(setCookie).toContain("Max-Age=300");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    await app.close();
  });

  it("GET /api/auth/slack redirects with the existing query string and state cookie contract", async () => {
    process.env["SLACK_CLIENT_ID"] = "slack-client";
    process.env["SLACK_CALLBACK_URL"] = "https://atom.example/api/auth/slack/callback";
    const app = await makeAuthApp();

    const response = await app.inject({ method: "GET", url: "/api/auth/slack" });
    const location = new URL(getSingleHeaderValue(response.headers.location));
    const setCookie = findSetCookieHeader(response.headers["set-cookie"], STATE_COOKIE_NAME);
    const stateCookie = extractCookieValue(setCookie, STATE_COOKIE_NAME);

    expect(response.statusCode).toBe(302);
    expect(location.origin + location.pathname).toBe("https://slack.com/oauth/v2/authorize");
    expect(location.searchParams.get("client_id")).toBe("slack-client");
    expect(location.searchParams.get("redirect_uri")).toBe("https://atom.example/api/auth/slack/callback");
    expect(location.searchParams.get("user_scope")).toBe("identity.basic,identity.email,identity.avatar");
    expect(location.searchParams.get("state")).toBe(stateCookie);
    expect(setCookie).toContain(`${STATE_COOKIE_NAME}=`);
    expect(setCookie).toContain("Max-Age=300");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    await app.close();
  });

  it("GET /api/auth/google preserves the existing not-configured response", async () => {
    const app = await makeAuthApp();

    const response = await app.inject({ method: "GET", url: "/api/auth/google" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "Google auth not configured" });
    await app.close();
  });

  it("GET /api/auth/slack preserves the existing not-configured response", async () => {
    const app = await makeAuthApp();

    const response = await app.inject({ method: "GET", url: "/api/auth/slack" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "Slack auth not configured" });
    await app.close();
  });

  it("GET /api/auth/google/callback preserves invalid_state redirect before network fetch", async () => {
    process.env["GOOGLE_CLIENT_ID"] = "google-client";
    process.env["GOOGLE_CLIENT_SECRET"] = "google-secret";
    process.env["GOOGLE_CALLBACK_URL"] = "https://atom.example/api/auth/google/callback";
    process.env["FRONTEND_URL"] = "https://dashboard.example";
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls += 1;
      throw new Error("unexpected network call");
    }) as typeof fetch;
    const app = await makeAuthApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/google/callback?code=code-1&state=expected-state",
      headers: { cookie: `${STATE_COOKIE_NAME}=other-state` },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://dashboard.example/?auth_error=invalid_state");
    expect(fetchCalls).toBe(0);
    await app.close();
  });

  it("GET /api/auth/slack/callback preserves invalid_state redirect before network fetch", async () => {
    process.env["SLACK_CLIENT_ID"] = "slack-client";
    process.env["SLACK_CLIENT_SECRET"] = "slack-secret";
    process.env["SLACK_CALLBACK_URL"] = "https://atom.example/api/auth/slack/callback";
    process.env["FRONTEND_URL"] = "https://dashboard.example";
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls += 1;
      throw new Error("unexpected network call");
    }) as typeof fetch;
    const app = await makeAuthApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/slack/callback?code=code-1&state=expected-state",
      headers: { cookie: `${STATE_COOKIE_NAME}=other-state` },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://dashboard.example/?auth_error=invalid_state");
    expect(fetchCalls).toBe(0);
    await app.close();
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

  it("POST /api/auth/logout clears the JWT cookie name without touching network or db", async () => {
    const app = await makeAuthApp();

    const response = await app.inject({ method: "POST", url: "/api/auth/logout" });
    const setCookie = getSingleHeaderValue(response.headers["set-cookie"]);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(setCookie).toContain(`${JWT_COOKIE_NAME}=`);
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).toContain("Path=/");
    await app.close();
  });
});
