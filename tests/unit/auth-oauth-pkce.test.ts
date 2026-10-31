import { createHash } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import type { FastifyReply, FastifyRequest } from "fastify";
import { agentKeyPreHandler } from "../../src/api/agent-key-auth.js";
import { JWT_COOKIE_NAME, STATE_COOKIE_NAME } from "../../src/api/routes/auth_helpers.js";
import {
  configureGoogleCallbackEnv,
  extractCookieValue,
  findSetCookieHeader,
  getSingleHeaderValue,
  googleTokenResponse,
  googleUserinfoResponse,
  makeFakeAuthDeps,
  makeInjectedAuthApp,
  makeUser,
  restoreAuthEnv,
  restoreAuthGlobals,
} from "./auth-route-test-utils.js";

const REDIRECT_URI = "http://127.0.0.1:43127/oauth/callback";

describe("atom OAuth authorization server", () => {
  beforeEach(() => {
    restoreAuthEnv();
  });

  afterEach(() => {
    restoreAuthGlobals();
  });

  it("publishes authorization server metadata at both discovery paths", async () => {
    process.env["FRONTEND_URL"] = "https://atom.example/dashboard/";
    const app = await makeInjectedAuthApp(makeFakeAuthDeps({ fetchResponses: [] }).deps as never);

    for (const path of ["/.well-known/oauth-authorization-server", "/api/auth/.well-known/oauth-authorization-server"]) {
      const response = await app.inject({ method: "GET", url: path });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        issuer: "https://atom.example",
        authorization_endpoint: "https://atom.example/api/auth/oauth/authorize",
        token_endpoint: "https://atom.example/api/auth/oauth/token",
        registration_endpoint: "https://atom.example/api/auth/oauth/register",
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported: ["none"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    await app.close();
  });

  it("rejects non-loopback redirects and unsupported client authentication", async () => {
    const app = await makeInjectedAuthApp(makeFakeAuthDeps({ fetchResponses: [] }).deps as never);
    const outsideLoopback = await app.inject({
      method: "POST",
      url: "/api/auth/oauth/register",
      payload: { redirect_uris: ["https://example.com/callback"] },
    });
    const unsupportedAuth = await app.inject({
      method: "POST",
      url: "/api/auth/oauth/register",
      payload: { redirect_uris: [REDIRECT_URI], token_endpoint_auth_method: "client_secret_post" },
    });

    expect(outsideLoopback.statusCode).toBe(400);
    expect(outsideLoopback.json()).toEqual({ error: "invalid_redirect_uri" });
    expect(unsupportedAuth.statusCode).toBe(400);
    expect(unsupportedAuth.json()).toEqual({ error: "invalid_client_metadata" });
    await app.close();
  });

  it("exchanges a PKCE code once, rejects a wrong verifier, and rotates refresh tokens", async () => {
    process.env["AUTH_BYPASS"] = "1";
    const app = await makeInjectedAuthApp(makeFakeAuthDeps({ fetchResponses: [] }).deps as never);
    const registration = await app.inject({
      method: "POST",
      url: "/api/auth/oauth/register",
      payload: { redirect_uris: [REDIRECT_URI] },
    });
    const clientId = registration.json().client_id as string;
    const verifier = "a-long-pkce-verifier-for-atom-oauth-client";
    const challenge = createHash("sha256").update(verifier).digest("base64url");

    async function authorize(state: string) {
      return app.inject({
        method: "GET",
        url: "/api/auth/oauth/authorize?" + new URLSearchParams({
          response_type: "code",
          client_id: clientId,
          redirect_uri: REDIRECT_URI,
          code_challenge: challenge,
          code_challenge_method: "S256",
          state,
        }),
      });
    }

    const badFlow = await authorize("state-bad");
    const badCode = new URL(getSingleHeaderValue(badFlow.headers.location)).searchParams.get("code")!;
    const wrongVerifier = await app.inject({
      method: "POST",
      url: "/api/auth/oauth/token",
      payload: { grant_type: "authorization_code", client_id: clientId, code: badCode, redirect_uri: REDIRECT_URI, code_verifier: "wrong" },
    });
    expect(wrongVerifier.statusCode).toBe(400);
    expect(wrongVerifier.json()).toEqual({ error: "invalid_grant" });

    const flow = await authorize("state-good");
    const code = new URL(getSingleHeaderValue(flow.headers.location)).searchParams.get("code")!;
    const tokenResponse = await app.inject({
      method: "POST",
      url: "/api/auth/oauth/token",
      payload: { grant_type: "authorization_code", client_id: clientId, code, redirect_uri: REDIRECT_URI, code_verifier: verifier },
    });
    expect(tokenResponse.statusCode).toBe(200);
    expect(tokenResponse.headers["cache-control"]).toBe("no-store");
    expect(tokenResponse.json()).toMatchObject({ token_type: "Bearer", expires_in: 3600 });
    const jwtSecret = new TextEncoder().encode(process.env["JWT_SECRET"]!);
    const tokens = tokenResponse.json() as { access_token: string; refresh_token: string };
    const access = await jwtVerify(tokens.access_token, jwtSecret);
    expect(access.payload).toMatchObject({ id: "bypass", typ: "access" });

    const reusedCode = await app.inject({
      method: "POST",
      url: "/api/auth/oauth/token",
      payload: { grant_type: "authorization_code", client_id: clientId, code, redirect_uri: REDIRECT_URI, code_verifier: verifier },
    });
    expect(reusedCode.statusCode).toBe(400);
    expect(reusedCode.json()).toEqual({ error: "invalid_grant" });

    const refresh = await app.inject({
      method: "POST",
      url: "/api/auth/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: tokens.refresh_token,
      }).toString(),
    });
    expect(refresh.statusCode).toBe(200);
    expect(refresh.json()).toHaveProperty("refresh_token");
    expect((await jwtVerify(refresh.json().refresh_token, jwtSecret)).payload).toMatchObject({
      sub: "bypass",
      client_id: clientId,
      typ: "atom_oauth_refresh",
    });

    const request = { headers: { authorization: `Bearer ${tokens.access_token}` } } as FastifyRequest;
    const replyState: { statusCode?: number; body?: unknown } = {};
    const reply = {
      code(statusCode: number) { replyState.statusCode = statusCode; return this; },
      send(body: unknown) { replyState.body = body; return this; },
    } as unknown as FastifyReply;
    await agentKeyPreHandler(request, reply);
    expect(request.jwtUser).toMatchObject({ id: "bypass", role: "admin" });
    expect(request.agentScope).toBe("write");
    await app.close();
  });

  it("authenticates Bearer access tokens in status and rejects OAuth-only token types", async () => {
    process.env["GOOGLE_CLIENT_ID"] = "google-client";
    const user = makeUser({ id: "oauth-viewer", email: "viewer@example.com", role: "viewer" });
    const harness = makeFakeAuthDeps({ users: { [user.email]: user }, fetchResponses: [] });
    const app = await makeInjectedAuthApp(harness.deps);
    const secret = new TextEncoder().encode(process.env["JWT_SECRET"]!);
    const loginCookie = await new SignJWT({ id: user.id, email: user.email, name: user.display_name, role: user.role })
      .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(secret);
    const client = await app.inject({
      method: "POST",
      url: "/api/auth/oauth/register",
      payload: { redirect_uris: [REDIRECT_URI] },
    });
    const clientId = client.json().client_id as string;
    const verifier = "viewer-pkce-verifier-long-enough";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorization = await app.inject({
      method: "GET",
      url: "/api/auth/oauth/authorize?" + new URLSearchParams({
        response_type: "code", client_id: clientId, redirect_uri: REDIRECT_URI,
        code_challenge: challenge, code_challenge_method: "S256", state: "viewer-state",
      }),
      headers: { cookie: `${JWT_COOKIE_NAME}=${loginCookie}` },
    });
    const code = new URL(getSingleHeaderValue(authorization.headers.location)).searchParams.get("code")!;
    const tokenResponse = await app.inject({
      method: "POST", url: "/api/auth/oauth/token",
      payload: { grant_type: "authorization_code", client_id: clientId, code, redirect_uri: REDIRECT_URI, code_verifier: verifier },
    });
    const tokens = tokenResponse.json() as { access_token: string; refresh_token: string };

    const status = await app.inject({
      method: "GET", url: "/api/auth/status", headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ authenticated: true, id: user.id, role: "viewer" });

    const refreshAsAccess = await app.inject({
      method: "GET", url: "/api/auth/status", headers: { authorization: `Bearer ${tokens.refresh_token}` },
    });
    expect(refreshAsAccess.json()).toEqual({ authenticated: false });

    const invalidScopeToken = await new SignJWT({
      id: user.id, email: user.email, name: user.display_name, role: user.role, typ: "atom_oauth_refresh",
    }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(secret);
    const request = { headers: { authorization: `Bearer ${invalidScopeToken}` } } as FastifyRequest;
    const replyState: { statusCode?: number; body?: unknown } = {};
    const reply = {
      code(statusCode: number) { replyState.statusCode = statusCode; return this; },
      send(body: unknown) { replyState.body = body; return this; },
    } as unknown as FastifyReply;
    await agentKeyPreHandler(request, reply);
    expect(replyState.statusCode).toBe(401);

    await app.close();
  });

  it("returns from Google login to the loopback client with an authorization code", async () => {
    configureGoogleCallbackEnv();
    process.env["ALLOWED_EMAIL"] = "@example.com";
    const harness = makeFakeAuthDeps({
      fetchResponses: [
        googleTokenResponse(),
        googleUserinfoResponse("oauth@example.com", "OAuth User"),
      ],
    });
    const app = await makeInjectedAuthApp(harness.deps as never);
    const registration = await app.inject({
      method: "POST",
      url: "/api/auth/oauth/register",
      payload: { redirect_uris: [REDIRECT_URI] },
    });
    const clientId = registration.json().client_id as string;
    const authorize = await app.inject({
      method: "GET",
      url: "/api/auth/oauth/authorize?" + new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        code_challenge: "challenge",
        code_challenge_method: "S256",
        state: "login-state",
      }),
    });
    expect(authorize.statusCode).toBe(302);
    expect(authorize.headers.location).toBe("/api/auth/google");
    const pendingCookie = findSetCookieHeader(authorize.headers["set-cookie"], "atom_oauth_pending");
    const googleStart = await app.inject({ method: "GET", url: "/api/auth/google" });
    const stateCookie = findSetCookieHeader(googleStart.headers["set-cookie"], STATE_COOKIE_NAME);
    const callback = await app.inject({
      method: "GET",
      url: "/api/auth/google/callback?code=google-code&state=" + new URL(getSingleHeaderValue(googleStart.headers.location)).searchParams.get("state"),
      headers: {
        cookie: `${pendingCookie.split(";")[0]}; ${stateCookie.split(";")[0]}`,
      },
    });

    expect(callback.statusCode).toBe(302);
    const redirect = new URL(getSingleHeaderValue(callback.headers.location));
    expect(redirect.origin + redirect.pathname).toBe(REDIRECT_URI);
    expect(redirect.searchParams.get("state")).toBe("login-state");
    expect(redirect.searchParams.get("code")).toBeTruthy();
    expect(findSetCookieHeader(callback.headers["set-cookie"], JWT_COOKIE_NAME)).toContain(`${JWT_COOKIE_NAME}=`);
    expect(extractCookieValue(stateCookie, STATE_COOKIE_NAME)).toBeTruthy();
    await app.close();
  });
});
