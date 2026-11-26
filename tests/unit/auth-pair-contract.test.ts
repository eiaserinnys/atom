import path from "path";
import { fileURLToPath } from "url";

import bcrypt from "bcryptjs";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { SignJWT } from "jose";

import { agentKeyVerifier } from "../../src/api/agent-key-auth.js";
import { authMiddleware } from "../../src/api/middleware/auth.js";
import { cardApiRoutes } from "../../src/api/routes/card_api.js";
import { cardRoutes } from "../../src/api/routes/cards.js";
import { treeRoutes } from "../../src/api/routes/tree.js";
import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import { closeDb, setDb } from "../../src/db/client.js";
import { insertAgent } from "../../src/db/queries/agents.js";
import { insertUser, type User } from "../../src/db/queries/users.js";

// Outer contract of the two JWT verification paths: the browser path
// (authMiddleware, cookie or Bearer, routes without the /api prefix) and the
// agent path (agentKeyPreHandler, x-api-key or Bearer, /api/cards and /api/tree).
// Only HTTP status and body are asserted so the tests survive moving the shared
// verification into one module.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations-sqlite");
const JWT_SECRET = "auth-pair-contract-secret";
const OTHER_SECRET = "some-other-signing-secret";
const originalEnv = { ...process.env };

type Mode = "oauth" | "password" | "bypass" | "unconfigured";
let db: SqliteAdapter;
let app: FastifyInstance;
let admin: User;
let editor: User;
let viewer: User;
let inactive: User;
const AGENT_WRITE_KEY = "pair-contract-write-key";
const AGENT_READ_KEY = "pair-contract-read-key";

function setMode(mode: Mode): void {
  for (const key of ["GOOGLE_CLIENT_ID", "SLACK_CLIENT_ID", "DASHBOARD_ADMIN_PASSWORD", "AUTH_BYPASS"]) {
    delete process.env[key];
  }
  if (mode === "oauth") process.env["GOOGLE_CLIENT_ID"] = "pair-contract-client";
  if (mode === "password") process.env["DASHBOARD_ADMIN_PASSWORD"] = "pair-contract-password";
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
  admin = await insertUser(db, { email: "pair-admin@example.test", display_name: "Pair Admin", role: "admin" });
  editor = await insertUser(db, { email: "pair-editor@example.test", display_name: "Pair Editor", role: "editor" });
  viewer = await insertUser(db, { email: "pair-viewer@example.test", display_name: "Pair Viewer", role: "viewer" });
  inactive = await insertUser(db, { email: "pair-inactive@example.test", role: "editor" });
  await db.query("UPDATE users SET is_active = 0 WHERE id = $1", [inactive.id]);
  await insertAgent(db, { agent_id: "pair-write", secret_hash: await bcrypt.hash(AGENT_WRITE_KEY, 4), scope: "write" });
  await insertAgent(db, { agent_id: "pair-read", secret_hash: await bcrypt.hash(AGENT_READ_KEY, 4), scope: "read" });
});

afterAll(async () => {
  await closeDb();
  process.env = { ...originalEnv };
});

beforeEach(async () => {
  setMode("oauth");
  agentKeyVerifier.clear();
  app = Fastify({ logger: false });
  await app.register(cookie);
  app.addHook("preHandler", authMiddleware);
  await app.register(cardRoutes);
  await app.register(treeRoutes);
  await app.register(cardApiRoutes);
});

afterEach(async () => {
  await app.close();
});

const NEW_CARD = { card_type: "knowledge", title: "pair contract card" };
const browser = (headers: Record<string, string> = {}) =>
  app.inject({ method: "GET", url: "/tree", headers });
const browserCreate = (headers: Record<string, string>) =>
  app.inject({ method: "POST", url: "/cards", headers, payload: NEW_CARD });
const agent = (headers: Record<string, string> = {}) =>
  app.inject({ method: "GET", url: "/api/tree", headers });
const agentCreate = (headers: Record<string, string>) =>
  app.inject({ method: "POST", url: "/api/cards", headers, payload: NEW_CARD });

describe("browser path (authMiddleware): rejections", () => {
  it("answers 401 Unauthorized without any credential", async () => {
    const res = await browser();
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Unauthorized" });
  });

  it.each([
    ["a garbage token", async () => "not-a-jwt"],
    ["a token signed with another secret", async () => tokenFor(viewer, {}, OTHER_SECRET)],
    ["an OAuth-only token type", async () => tokenFor(viewer, { typ: "atom_oauth_refresh" })],
    ["a token without a string id", async () => tokenFor(viewer, { id: 12345 })],
  ])("answers 401 Invalid token for %s", async (_name, makeToken) => {
    const res = await browser({ cookie: `atom_auth=${await makeToken()}` });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Invalid token" });
  });

  it("answers 401 Unauthorized when the user row is missing or inactive", async () => {
    const ghost = await tokenFor(viewer, { id: "00000000-0000-4000-8000-000000000999" });
    const gone = await browser({ cookie: `atom_auth=${ghost}` });
    expect(gone.statusCode).toBe(401);
    expect(gone.json()).toEqual({ error: "Unauthorized" });
    const off = await browser({ cookie: `atom_auth=${await tokenFor(inactive)}` });
    expect(off.statusCode).toBe(401);
    expect(off.json()).toEqual({ error: "Unauthorized" });
  });
});

describe("browser path (authMiddleware): accepted credentials", () => {
  it("reads the token from the atom_auth cookie or a Bearer header", async () => {
    const token = await tokenFor(viewer);
    expect((await browser({ cookie: `atom_auth=${token}` })).statusCode).toBe(200);
    expect((await browser({ authorization: `Bearer ${token}` })).statusCode).toBe(200);
  });

  it("prefers the cookie over the Bearer header (a bad cookie is not rescued by a good Bearer)", async () => {
    const res = await browser({ cookie: "atom_auth=not-a-jwt", authorization: `Bearer ${await tokenFor(viewer)}` });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Invalid token" });
  });

  it("uses the database role, not the role claim, for the viewer write block", async () => {
    const asAdminClaim = { cookie: `atom_auth=${await tokenFor(viewer, { role: "admin" })}` };
    const blocked = await browserCreate(asAdminClaim);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toEqual({ error: "Forbidden" });
    expect((await browser(asAdminClaim)).statusCode).toBe(200);
    const asViewerClaim = { cookie: `atom_auth=${await tokenFor(editor, { role: "viewer" })}` };
    expect((await browserCreate(asViewerClaim)).statusCode).toBe(201);
  });

  it("keeps the viewer on read-only methods and the read-only POST list", async () => {
    const headers = { cookie: `atom_auth=${await tokenFor(viewer)}` };
    const created = await browserCreate({ cookie: `atom_auth=${await tokenFor(editor)}` });
    const nodeId = created.json<{ node_id: string }>().node_id;
    const cardId = created.json<{ id: string }>().id;
    expect((await app.inject({ method: "POST", url: `/tree/${nodeId}/compile`, headers, payload: {} })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/tree/${nodeId}/compile/sections`, headers, payload: {} })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/tree/compile/contents", headers, payload: { card_ids: [cardId] } })).statusCode).toBe(200);
    for (const [method, url] of [["PUT", `/cards/${cardId}`], ["DELETE", `/cards/${cardId}`], ["POST", "/tree/symlink"], ["PUT", `/tree/${nodeId}/move`], ["PATCH", `/tree/${nodeId}`]] as const) {
      const res = await app.inject({ method, url, headers, payload: {} });
      expect([method, url, res.statusCode]).toEqual([method, url, 403]);
      expect(res.json()).toEqual({ error: "Forbidden" });
    }
  });
});

describe("browser path (authMiddleware): auth modes", () => {
  it("answers 401 in unconfigured mode even for a valid token", async () => {
    setMode("unconfigured");
    const res = await browser({ cookie: `atom_auth=${await tokenFor(admin)}` });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Unauthorized" });
  });

  it("verifies tokens like OAuth mode in password mode", async () => {
    setMode("password");
    expect((await browser({ cookie: `atom_auth=${await tokenFor(admin)}` })).statusCode).toBe(200);
    expect((await browser()).statusCode).toBe(401);
  });

  it("gives every request a virtual admin in bypass mode, token or not", async () => {
    setMode("bypass");
    expect((await browser()).statusCode).toBe(200);
    expect((await browser({ authorization: "Bearer garbage" })).statusCode).toBe(200);
    expect((await browserCreate({})).statusCode).toBe(201);
  });

  it("does not exempt anything but the listed prefixes", async () => {
    setMode("unconfigured");
    expect((await app.inject({ method: "GET", url: "/cards/00000000-0000-4000-8000-000000000001" })).statusCode).toBe(401);
    const agentRoute = await agent();
    expect(agentRoute.statusCode).toBe(401);
    expect(agentRoute.json()).toEqual({ error: "x-api-key header required" });
  });
});

describe("agent path (agentKeyPreHandler): rejections", () => {
  it("answers 401 'x-api-key header required' with no key and no Bearer token", async () => {
    const res = await agent();
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "x-api-key header required" });
  });

  it("ignores the browser cookie", async () => {
    const res = await agent({ cookie: `atom_auth=${await tokenFor(admin)}` });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "x-api-key header required" });
  });

  it("answers 401 Unauthorized for a wrong key", async () => {
    const res = await agent({ "x-api-key": "wrong-key" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Unauthorized" });
  });

  it.each([
    ["a garbage token", async () => "not-a-jwt"],
    ["a token signed with another secret", async () => tokenFor(editor, {}, OTHER_SECRET)],
    ["an OAuth-only token type", async () => tokenFor(editor, { typ: "atom_oauth_refresh" })],
    ["a token without a string id", async () => tokenFor(editor, { id: 12345 })],
    ["a token for a missing user", async () => tokenFor(editor, { id: "00000000-0000-4000-8000-000000000999" })],
    ["a token for an inactive user", async () => tokenFor(inactive)],
  ])("answers a plain 401 Unauthorized for %s", async (_name, makeToken) => {
    const res = await agent({ authorization: `Bearer ${await makeToken()}` });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Unauthorized" });
  });

  it("does not fall back to Bearer when an x-api-key is present", async () => {
    const res = await agent({ "x-api-key": "wrong-key", authorization: `Bearer ${await tokenFor(editor)}` });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Unauthorized" });
    expect((await agent({ "x-api-key": AGENT_WRITE_KEY, authorization: "Bearer garbage" })).statusCode).toBe(200);
  });
});

describe("agent path (agentKeyPreHandler): scope by key or by database role", () => {
  it("lets a write key read and create, and a read key only read", async () => {
    expect((await agentCreate({ "x-api-key": AGENT_WRITE_KEY })).statusCode).toBe(201);
    const denied = await agentCreate({ "x-api-key": AGENT_READ_KEY });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({
      error: "This API key has read scope, so the write route POST /api/cards is disabled. Use an API key with write scope.",
      code: "INSUFFICIENT_SCOPE",
    });
    expect((await agent({ "x-api-key": AGENT_READ_KEY })).statusCode).toBe(200);
  });

  it("maps Bearer admin and editor to write and viewer to read", async () => {
    for (const user of [admin, editor]) {
      expect((await agentCreate({ authorization: `Bearer ${await tokenFor(user)}` })).statusCode).toBe(201);
    }
    const viewerHeaders = { authorization: `Bearer ${await tokenFor(viewer)}` };
    const denied = await agentCreate(viewerHeaders);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({
      error: "This account is viewer, so the write route POST /api/cards is disabled. Use an account with the editor or admin role.",
      code: "INSUFFICIENT_SCOPE",
    });
    expect((await agent(viewerHeaders)).statusCode).toBe(200);
  });

  it("takes the role from the database, not from the token claim", async () => {
    const claimsAdmin = { authorization: `Bearer ${await tokenFor(viewer, { role: "admin" })}` };
    expect((await agentCreate(claimsAdmin)).statusCode).toBe(403);
    const claimsViewer = { authorization: `Bearer ${await tokenFor(editor, { role: "viewer" })}` };
    expect((await agentCreate(claimsViewer)).statusCode).toBe(201);
  });
});

describe("agent path (agentKeyPreHandler): bypass", () => {
  it("accepts a signed bypass-id token as admin only while bypass mode is on", async () => {
    const headers = { authorization: `Bearer ${await sign({ id: "bypass", email: "bypass@local", name: "Bypass Admin", role: "admin" })}` };
    setMode("bypass");
    expect((await agentCreate(headers)).statusCode).toBe(201);
    for (const mode of ["oauth", "password", "unconfigured"] as const) {
      setMode(mode);
      const res = await agent(headers);
      expect([mode, res.statusCode]).toEqual([mode, 401]);
      expect(res.json()).toEqual({ error: "Unauthorized" });
    }
  });

  it("does not hand out a virtual admin to requests without credentials", async () => {
    setMode("bypass");
    const res = await agent();
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "x-api-key header required" });
    expect((await agent({ authorization: "Bearer garbage" })).statusCode).toBe(401);
  });
});
