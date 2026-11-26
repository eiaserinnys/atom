import path from "path";
import { fileURLToPath } from "url";

import { SignJWT } from "jose";

import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import { closeDb, setDb } from "../../src/db/client.js";
import { insertUser, type User } from "../../src/db/queries/users.js";
import { makeAuthApp } from "./auth-route-test-utils.js";

// Outer contract of the two places in src/api/routes/auth.ts that verify the login JWT on
// their own: GET /api/auth/status (cookie or Bearer) and the OAuth authorize route, which
// reads the login cookie to decide whether to issue a code at once or send the user to a
// login provider. Only HTTP status, body and the redirect target are asserted, so the
// tests survive moving the shared verification into one module.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations-sqlite");
const JWT_SECRET = "auth-routes-token-contract-secret";
const OTHER_SECRET = "some-other-signing-secret";
const REDIRECT_URI = "http://127.0.0.1:43127/oauth/callback";
const originalEnv = { ...process.env };

type Mode = "oauth" | "password" | "bypass" | "unconfigured";
let db: SqliteAdapter;
let named: User;
let unnamed: User;
let inactive: User;

function setMode(mode: Mode): void {
  for (const key of ["GOOGLE_CLIENT_ID", "SLACK_CLIENT_ID", "DASHBOARD_ADMIN_PASSWORD", "AUTH_BYPASS"]) {
    delete process.env[key];
  }
  if (mode === "oauth") process.env["GOOGLE_CLIENT_ID"] = "token-contract-client";
  if (mode === "password") process.env["DASHBOARD_ADMIN_PASSWORD"] = "token-contract-password";
  if (mode === "bypass") process.env["AUTH_BYPASS"] = "1";
}

async function sign(claims: Record<string, unknown>, secret = JWT_SECRET): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(secret));
}

const tokenFor = (user: User, claims: Record<string, unknown> = {}, secret = JWT_SECRET) =>
  sign({ id: user.id, email: user.email, name: "Token Name", role: user.role, ...claims }, secret);

beforeAll(async () => {
  process.env["JWT_SECRET"] = JWT_SECRET;
  db = new SqliteAdapter(":memory:");
  setDb(db);
  await db.runMigrations(MIGRATIONS_DIR);
  named = await insertUser(db, { email: "token-named@example.test", display_name: "Stored Name", role: "editor" });
  unnamed = await insertUser(db, { email: "token-unnamed@example.test", role: "viewer" });
  inactive = await insertUser(db, { email: "token-inactive@example.test", display_name: "Gone", role: "editor" });
  await db.query("UPDATE users SET is_active = 0 WHERE id = $1", [inactive.id]);
});

afterAll(async () => {
  await closeDb();
  process.env = { ...originalEnv };
});

beforeEach(() => {
  setMode("oauth");
});

const NOT_AUTHENTICATED = { authenticated: false };
const cookieOf = (token: string) => ({ cookie: `atom_auth=${token}` });
const bearerOf = (token: string) => ({ authorization: `Bearer ${token}` });

async function status(headers: Record<string, string> = {}) {
  const app = await makeAuthApp();
  try {
    const res = await app.inject({ method: "GET", url: "/api/auth/status", headers });
    return { status: res.statusCode, body: res.json() };
  } finally {
    await app.close();
  }
}

// authorize answers a redirect: back to the client with a code when the cookie names an active
// user, otherwise on to the login provider (or 503 when none is configured).
async function authorize(headers: Record<string, string> = {}): Promise<string> {
  const app = await makeAuthApp();
  try {
    const registered = await app.inject({ method: "POST", url: "/api/auth/oauth/register", payload: { redirect_uris: [REDIRECT_URI] } });
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/oauth/authorize?" + new URLSearchParams({
        response_type: "code",
        client_id: registered.json().client_id,
        redirect_uri: REDIRECT_URI,
        code_challenge: "token-contract-challenge",
        code_challenge_method: "S256",
        state: "token-contract-state",
      }),
      headers,
    });
    if (res.statusCode === 503) return `503 ${JSON.stringify(res.json())}`;
    const location = String(res.headers.location);
    if (res.statusCode === 302 && location.startsWith(`${REDIRECT_URI}?code=`)) return "issued code";
    return `${res.statusCode} ${location}`;
  } finally {
    await app.close();
  }
}

describe("GET /api/auth/status: tokens that are not accepted", () => {
  it("answers authenticated:false without any token", async () => {
    expect(await status()).toEqual({ status: 200, body: NOT_AUTHENTICATED });
  });

  it.each([
    ["a garbage token", async () => "not-a-jwt"],
    ["a token signed with another secret", async () => tokenFor(named, {}, OTHER_SECRET)],
    ["an OAuth-only token type", async () => tokenFor(named, { typ: "atom_oauth_refresh" })],
    ["a token without a string id", async () => tokenFor(named, { id: 12345 })],
    ["a token for a missing user", async () => tokenFor(named, { id: "00000000-0000-4000-8000-000000000999" })],
    ["a token for an inactive user", async () => tokenFor(inactive)],
  ])("answers 200 authenticated:false for %s, in the cookie or as Bearer", async (_name, makeToken) => {
    const token = await makeToken();
    expect(await status(cookieOf(token))).toEqual({ status: 200, body: NOT_AUTHENTICATED });
    expect(await status(bearerOf(token))).toEqual({ status: 200, body: NOT_AUTHENTICATED });
  });

  it("ignores an Authorization header that is not a Bearer token", async () => {
    const token = await tokenFor(named);
    expect(await status({ authorization: `Basic ${token}` })).toEqual({ status: 200, body: NOT_AUTHENTICATED });
  });
});

describe("GET /api/auth/status: accepted tokens", () => {
  it("returns the stored user for a cookie token or a Bearer token", async () => {
    const token = await tokenFor(named);
    const expected = { status: 200, body: { authenticated: true, id: named.id, email: named.email, name: "Stored Name", role: "editor" } };
    expect(await status(cookieOf(token))).toEqual(expected);
    expect(await status(bearerOf(token))).toEqual(expected);
  });

  it("falls back to the name claim of the token when the user has no display name", async () => {
    const res = await status(cookieOf(await tokenFor(unnamed)));
    expect(res).toEqual({ status: 200, body: { authenticated: true, id: unnamed.id, email: unnamed.email, name: "Token Name", role: "viewer" } });
  });

  it("accepts a token without a type claim and a token typed access", async () => {
    for (const claims of [{}, { typ: "access" }]) {
      const res = await status(cookieOf(await tokenFor(named, claims)));
      expect([claims, res.body.authenticated]).toEqual([claims, true]);
    }
  });

  it("takes id, email and role from the database, not from the claims", async () => {
    const token = await tokenFor(named, { email: "claimed@example.test", role: "admin" });
    expect((await status(cookieOf(token))).body).toMatchObject({ id: named.id, email: named.email, role: "editor" });
  });

  it("prefers the cookie over the Bearer header (a bad cookie is not rescued by a good Bearer)", async () => {
    const res = await status({ cookie: "atom_auth=not-a-jwt", authorization: `Bearer ${await tokenFor(named)}` });
    expect(res).toEqual({ status: 200, body: NOT_AUTHENTICATED });
  });
});

describe("GET /api/auth/status: auth modes", () => {
  it("verifies tokens the same way in password mode", async () => {
    setMode("password");
    expect((await status(cookieOf(await tokenFor(named)))).body).toMatchObject({ authenticated: true, id: named.id });
    expect((await status()).body).toEqual(NOT_AUTHENTICATED);
  });

  it("answers authenticated:false in unconfigured mode even for a valid token", async () => {
    setMode("unconfigured");
    expect(await status(cookieOf(await tokenFor(named)))).toEqual({ status: 200, body: NOT_AUTHENTICATED });
  });

  it("answers the virtual admin in bypass mode with or without a token", async () => {
    setMode("bypass");
    const admin = { status: 200, body: { authenticated: true, id: "bypass", email: "bypass@local", name: "Bypass Admin", role: "admin" } };
    expect(await status()).toEqual(admin);
    expect(await status(bearerOf("garbage"))).toEqual(admin);
  });
});

describe("GET /api/auth/oauth/authorize: login cookie check", () => {
  it("issues a code at once for the cookie of an active user", async () => {
    expect(await authorize(cookieOf(await tokenFor(named)))).toBe("issued code");
    expect(await authorize(cookieOf(await tokenFor(unnamed)))).toBe("issued code");
  });

  it.each([
    ["no cookie", async () => undefined],
    ["a garbage token", async () => "not-a-jwt"],
    ["a token signed with another secret", async () => tokenFor(named, {}, OTHER_SECRET)],
    ["an OAuth-only token type", async () => tokenFor(named, { typ: "atom_oauth_refresh" })],
    ["a token without a string id", async () => tokenFor(named, { id: 12345 })],
    ["a token for a missing user", async () => tokenFor(named, { id: "00000000-0000-4000-8000-000000000999" })],
    ["a token for an inactive user", async () => tokenFor(inactive)],
  ])("sends the user on to the login provider for %s", async (_name, makeToken) => {
    const token = await makeToken();
    expect(await authorize(token ? cookieOf(token) : {})).toBe("302 /api/auth/google");
  });

  it("does not read a Bearer header", async () => {
    expect(await authorize(bearerOf(await tokenFor(named)))).toBe("302 /api/auth/google");
  });

  it("answers 503 when no login provider is configured and the user is not recognised", async () => {
    setMode("unconfigured");
    expect(await authorize()).toBe('503 {"error":"OAuth login provider not configured"}');
  });

  // Current behavior: the cookie is verified in every mode, so a valid cookie gets a code
  // even in unconfigured and password mode.
  it("verifies the cookie in unconfigured and password mode too (current behavior)", async () => {
    for (const mode of ["unconfigured", "password"] as const) {
      setMode(mode);
      expect([mode, await authorize(cookieOf(await tokenFor(named)))]).toEqual([mode, "issued code"]);
    }
  });

  it("issues a code for the virtual admin in bypass mode without any cookie", async () => {
    setMode("bypass");
    expect(await authorize()).toBe("issued code");
    expect(await authorize(cookieOf("not-a-jwt"))).toBe("issued code");
  });
});
