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
import {
  extractCookieValue,
  findSetCookieHeader,
  getSingleHeaderValue,
  makeAuthApp,
  makeFakeAuthDeps,
  makeInjectedAuthApp,
  configureGoogleCallbackEnv,
  googleTokenResponse,
  googleUserinfoResponse,
  makeUser,
  restoreAuthEnv,
  restoreAuthGlobals,
} from "./auth-route-test-utils.js";

describe("auth route safety boundaries", () => {
  beforeEach(() => {
    restoreAuthEnv();
  });

  afterEach(() => {
    restoreAuthGlobals();
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
    expect(getStateCookieOptions("development")).toEqual({
      httpOnly: true,
      secure: false,
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

  it("GET /api/auth/status returns the bypass admin response only when explicitly enabled", async () => {
    process.env["AUTH_BYPASS"] = "1";
    const app = await makeAuthApp();

    const response = await app.inject({ method: "GET", url: "/api/auth/status" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(buildBypassAuthStatus());
    await app.close();
  });

  it("GET /api/auth/status returns the unauthenticated response without explicit bypass", async () => {
    const app = await makeAuthApp();

    const response = await app.inject({ method: "GET", url: "/api/auth/status" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ authenticated: false });
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

  it("GET /api/auth/google binds the configured motion-page selector into state and its cookie", async () => {
    process.env["GOOGLE_CLIENT_ID"] = "google-client";
    process.env["GOOGLE_CALLBACK_URL"] = "https://atom.example/api/auth/google/callback";
    process.env["SEARCH_MOTION_PAGE_URL"] = "https://pages.example/d/atom-search-motion";
    const app = await makeAuthApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/google?return_to=atom-search-motion",
    });
    const location = new URL(getSingleHeaderValue(response.headers.location));
    const state = location.searchParams.get("state") ?? "";
    const stateCookie = findSetCookieHeader(response.headers["set-cookie"], STATE_COOKIE_NAME);

    expect(response.statusCode).toBe(302);
    expect(state).toMatch(/^[a-f0-9]{32}\.atom-search-motion$/);
    expect(extractCookieValue(stateCookie, STATE_COOKIE_NAME)).toBe(state);
    expect(stateCookie).toContain("HttpOnly");
    expect(stateCookie).toContain("SameSite=Lax");
    await app.close();
  });

  it("GET /api/auth/google rejects the motion-page selector when it is not configured", async () => {
    process.env["GOOGLE_CLIENT_ID"] = "google-client";
    const app = await makeAuthApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/google?return_to=atom-search-motion",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid return_to" });
    expect(response.headers["set-cookie"]).toBeUndefined();
    await app.close();
  });

  it("GET /api/auth/google rejects arbitrary, array, and duplicate return selectors before setting state", async () => {
    process.env["GOOGLE_CLIENT_ID"] = "google-client";
    const app = await makeAuthApp();

    for (const url of [
      "/api/auth/google?return_to=https%3A%2F%2Fevil.example",
      "/api/auth/google?return_to=atom-search-motion&return_to=atom-search-motion",
    ]) {
      const response = await app.inject({ method: "GET", url });

      expect(response.statusCode).toBe(400);
      expect(response.headers.location).toBeUndefined();
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
    await app.close();
  });

  it("GET /api/auth/google/callback sends valid motion state to the configured page error URL", async () => {
    configureGoogleCallbackEnv();
    process.env["FRONTEND_URL"] = "https://dashboard.example";
    process.env["SEARCH_MOTION_PAGE_URL"] = "https://pages.example/d/atom-search-motion";
    const state = `${"a".repeat(32)}.atom-search-motion`;
    const app = await makeAuthApp();

    const response = await app.inject({
      method: "GET",
      url: `/api/auth/google/callback?state=${state}&error=access_denied`,
      headers: { cookie: `${STATE_COOKIE_NAME}=${state}` },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      "https://pages.example/d/atom-search-motion/?auth_error=google_error",
    );
    expect(getSingleHeaderValue(response.headers["set-cookie"])).toContain(`${STATE_COOKIE_NAME}=`);
    await app.close();
  });

  it("GET /api/auth/google/callback does not route a motion state without a matching cookie to Pages", async () => {
    configureGoogleCallbackEnv();
    process.env["FRONTEND_URL"] = "https://dashboard.example";
    const state = `${"b".repeat(32)}.atom-search-motion`;
    const harness = makeFakeAuthDeps({ fetchResponses: [] });
    const app = await makeInjectedAuthApp(harness.deps);

    for (const cookie of [undefined, `${STATE_COOKIE_NAME}=other-state`]) {
      const response = await app.inject({
        method: "GET",
        url: `/api/auth/google/callback?code=code-1&state=${state}`,
        headers: cookie ? { cookie } : {},
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("https://dashboard.example/?auth_error=invalid_state");
    }
    expect(harness.fetchCalls).toHaveLength(0);
    await app.close();
  });

  it("GET /api/auth/google/callback keeps arbitrary callback selectors out of the redirect destination", async () => {
    configureGoogleCallbackEnv();
    process.env["FRONTEND_URL"] = "https://dashboard.example";
    process.env["SEARCH_MOTION_PAGE_URL"] = "https://pages.example/d/atom-search-motion";
    const state = `${"c".repeat(32)}.atom-search-motion`;
    const harness = makeFakeAuthDeps({
      users: { "user@example.com": makeUser({ email: "user@example.com" }) },
      fetchResponses: [googleTokenResponse(), googleUserinfoResponse("user@example.com", "User")],
    });
    const app = await makeInjectedAuthApp(harness.deps);

    const response = await app.inject({
      method: "GET",
      url: `/api/auth/google/callback?code=code-1&state=${state}&return_to=https%3A%2F%2Fevil.example`,
      headers: { cookie: `${STATE_COOKIE_NAME}=${state}` },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://pages.example/d/atom-search-motion/");
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
