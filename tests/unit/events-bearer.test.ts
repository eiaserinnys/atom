import path from "node:path";
import { fileURLToPath } from "node:url";
import http, { type IncomingMessage } from "node:http";
import { once } from "node:events";

import { jest } from "@jest/globals";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { SignJWT } from "jose";

import { authMiddleware } from "../../src/api/middleware/auth.js";
import { eventsRoutes } from "../../src/api/routes/events.js";
import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import { closeDb, setDb } from "../../src/db/client.js";
import { insertUser, type User } from "../../src/db/queries/users.js";
import { eventBus } from "../../src/events/eventBus.js";
import type { AtomEvent } from "../../src/shared/types.js";

const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/db/migrations-sqlite");
const secret = "events-bearer-test-secret";
const originalEnv = { ...process.env };
const event: AtomEvent = { type: "card:deleted", cardId: "test-card", nodeIds: [], parentNodeIds: [], actor: null };
let db: SqliteAdapter;
let app: FastifyInstance;
let user: User;
let port: number;
let response: IncomingMessage | undefined;

beforeAll(async () => {
  process.env["JWT_SECRET"] = secret;
  process.env["GOOGLE_CLIENT_ID"] = "test-provider";
  delete process.env["SLACK_CLIENT_ID"];
  delete process.env["AUTH_BYPASS"];
  db = new SqliteAdapter(":memory:");
  setDb(db);
  await db.runMigrations(migrations);
  user = await insertUser(db, { email: "events-bearer@example.test", role: "viewer" });
});

afterAll(async () => {
  await closeDb();
  process.env = { ...originalEnv };
});

beforeEach(async () => {
  app = Fastify({ logger: false });
  await app.register(cookie);
  app.addHook("preHandler", authMiddleware);
  await app.register(eventsRoutes);
  await app.listen({ host: "127.0.0.1", port: 0 });
  port = (app.server.address() as { port: number }).port;
});

afterEach(async () => {
  jest.restoreAllMocks();
  response?.destroy();
  response = undefined;
  await app.close();
});

async function openBearerStream(expiration?: number): Promise<IncomingMessage> {
  const jwt = new SignJWT({ id: user.id }).setProtectedHeader({ alg: "HS256" });
  if (expiration !== undefined) jwt.setExpirationTime(expiration);
  const token = await jwt.sign(new TextEncoder().encode(secret));
  const request = http.get(`http://127.0.0.1:${port}/events`, {
    headers: { authorization: `Bearer ${token}` },
  });
  [response] = await once(request, "response", { signal: AbortSignal.timeout(2000) }) as [IncomingMessage];
  expect(response.statusCode).toBe(200);
  expect(response.headers["content-type"]).toContain("text/event-stream");
  return response;
}

test("Bearer stream receives an atom event without a cookie", async () => {
  const stream = await openBearerStream(Math.floor(Date.now() / 1000) + 60);
  const data = once(stream, "data", { signal: AbortSignal.timeout(2000) });
  eventBus.emit("atom:event", event);
  const [chunk] = await data;
  expect(chunk.toString()).toBe(`data: ${JSON.stringify(event)}\n\n`);
});

test("Bearer stream closes without sending an event after token expiration", async () => {
  const expiration = Math.floor(Date.now() / 1000) + 60;
  const stream = await openBearerStream(expiration);
  let body = "";
  stream.on("data", chunk => { body += chunk.toString(); });
  const closed = once(stream, "close", { signal: AbortSignal.timeout(2000) });
  jest.spyOn(Date, "now").mockReturnValue((expiration + 1) * 1000);
  eventBus.emit("atom:event", event);
  await closed;
  expect(body).toBe("");
});

test("Bearer stream without an expiration still receives events", async () => {
  const stream = await openBearerStream();
  const data = once(stream, "data", { signal: AbortSignal.timeout(2000) });
  eventBus.emit("atom:event", event);
  const [chunk] = await data;
  expect(chunk.toString()).toBe(`data: ${JSON.stringify(event)}\n\n`);
});
