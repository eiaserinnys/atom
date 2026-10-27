import path from "path";
import { fileURLToPath } from "url";

import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { SignJWT } from "jose";

import { authMiddleware } from "../../src/api/middleware/auth.js";
import { configRoutes } from "../../src/api/routes/config.js";
import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import { setDb } from "../../src/db/client.js";
import { countAdmins, insertUser, type User } from "../../src/db/queries/users.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations-sqlite");
const JWT_SECRET = "u9-admin-protection-sqlite-secret";
const originalEnv = { ...process.env };
let db: SqliteAdapter;
let app: FastifyInstance;

beforeAll(async () => {
  process.env["JWT_SECRET"] = JWT_SECRET;
  process.env["GOOGLE_CLIENT_ID"] = "u9-sqlite-test-client";
  delete process.env["SLACK_CLIENT_ID"];
  delete process.env["AUTH_BYPASS"];
  db = new SqliteAdapter(":memory:");
  setDb(db);
  await db.runMigrations(MIGRATIONS_DIR);
});

afterAll(async () => {
  await db.close();
  process.env = { ...originalEnv };
});

beforeEach(async () => {
  app = Fastify({ logger: false });
  await app.register(cookie);
  app.addHook("preHandler", authMiddleware);
  await app.register(configRoutes);
});

afterEach(async () => {
  await app.close();
});

async function createAdmin(email: string): Promise<User> {
  return insertUser(db, { email, role: "admin" });
}

async function cookieFor(user: User): Promise<string> {
  const token = await new SignJWT({ id: user.id, email: user.email, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(JWT_SECRET));
  return `atom_auth=${token}`;
}

describe("U9 SQLite sequential last-admin protection", () => {
  it("allows removing one of two admins and rejects removing the remaining one", async () => {
    const first = await createAdmin("first-admin@example.test");
    const second = await createAdmin("second-admin@example.test");

    const firstResponse = await app.inject({
      method: "PATCH",
      url: `/api/config/users/${first.id}`,
      headers: { cookie: await cookieFor(first) },
      payload: { is_active: false },
    });
    const secondResponse = await app.inject({
      method: "PATCH",
      url: `/api/config/users/${second.id}`,
      headers: { cookie: await cookieFor(second) },
      payload: { role: "editor" },
    });

    expect(firstResponse.statusCode).toBe(200);
    expect(secondResponse.statusCode).toBe(400);
    expect(secondResponse.json()).toEqual({ error: "Cannot remove the last admin" });
    expect(await countAdmins(db)).toBe(1);
  });
});
