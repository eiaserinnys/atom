import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { jwtVerify } from "jose";
import { authRoutes, createAuthRoutes, type AuthRoutesDeps } from "../../src/api/routes/auth.js";
import { JWT_COOKIE_NAME } from "../../src/api/routes/auth_helpers.js";
import type { User } from "../../src/db/queries/users.js";

const savedEnv = { ...process.env };
const savedFetch = globalThis.fetch;

export function restoreAuthEnv() {
  process.env = { ...savedEnv };
  delete process.env["GOOGLE_CLIENT_ID"];
  delete process.env["GOOGLE_CLIENT_SECRET"];
  delete process.env["GOOGLE_CALLBACK_URL"];
  delete process.env["SLACK_CLIENT_ID"];
  delete process.env["SLACK_CLIENT_SECRET"];
  delete process.env["SLACK_CALLBACK_URL"];
  delete process.env["SLACK_ALLOWED_TEAM_ID"];
  delete process.env["FRONTEND_URL"];
  delete process.env["ALLOWED_EMAIL"];
  process.env["JWT_SECRET"] = "test-secret-for-auth-route-safety";
}

export function restoreAuthGlobals() {
  process.env = { ...savedEnv };
  globalThis.fetch = savedFetch;
}

export async function makeAuthApp() {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(authRoutes);
  return app;
}

export async function makeInjectedAuthApp(deps: AuthRoutesDeps) {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(createAuthRoutes(deps));
  return app;
}

export function getSingleHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export function getHeaderValues(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

export function extractCookieValue(setCookie: string, name: string): string {
  const match = setCookie.match(new RegExp(`${name}=([^;]+)`));
  if (!match) throw new Error(`Cookie not found: ${name}`);
  return match[1];
}

export function findSetCookieHeader(value: string | string[] | undefined, name: string): string {
  const header = getHeaderValues(value).find((item) => item.startsWith(`${name}=`));
  if (!header) throw new Error(`Set-Cookie header not found: ${name}`);
  return header;
}

export function jsonResponse(ok: boolean, body: unknown): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

export function makeUser(input: {
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

export function makeFakeAuthDeps(input: {
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

export function configureGoogleCallbackEnv() {
  process.env["GOOGLE_CLIENT_ID"] = "google-client";
  process.env["GOOGLE_CLIENT_SECRET"] = "google-secret";
  process.env["GOOGLE_CALLBACK_URL"] = "https://atom.example/api/auth/google/callback";
}

export function configureSlackCallbackEnv() {
  process.env["SLACK_CLIENT_ID"] = "slack-client";
  process.env["SLACK_CLIENT_SECRET"] = "slack-secret";
  process.env["SLACK_CALLBACK_URL"] = "https://atom.example/api/auth/slack/callback";
}

export function googleTokenResponse(accessToken = "google-access") {
  return jsonResponse(true, { access_token: accessToken });
}

export function googleUserinfoResponse(email: string, name: string, ok = true) {
  return jsonResponse(ok, { email, name });
}

export function slackTokenResponse(accessToken = "slack-access", ok = true) {
  return jsonResponse(true, {
    ok,
    authed_user: ok ? { access_token: accessToken } : undefined,
    error: ok ? undefined : "bad_code",
  });
}

export function slackIdentityResponse(input: {
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

export async function expectJwtCookiePayload(setCookie: string, expected: {
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
