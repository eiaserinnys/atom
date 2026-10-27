import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { SignJWT } from "jose";

import { authMiddleware } from "../../src/api/middleware/auth.js";
import { configRoutes } from "../../src/api/routes/config.js";
import {
  countAdmins,
  findUserById,
  insertUser,
  type User,
} from "../../src/db/queries/users.js";
import { getIntegrationTestPool, setupIntegrationTestDb } from "./integration-harness.js";

setupIntegrationTestDb();

const JWT_SECRET = "u9-admin-protection-integration-secret";
const originalEnv = { ...process.env };
let app: FastifyInstance;

beforeAll(() => {
  process.env["JWT_SECRET"] = JWT_SECRET;
  process.env["GOOGLE_CLIENT_ID"] = "u9-integration-test-client";
  delete process.env["SLACK_CLIENT_ID"];
  delete process.env["AUTH_BYPASS"];
});

afterAll(() => {
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

async function createUser(role: User["role"]): Promise<User> {
  return insertUser(getIntegrationTestPool(), {
    email: `${crypto.randomUUID()}@example.test`,
    role,
  });
}

async function cookieFor(user: User): Promise<string> {
  const token = await new SignJWT({
    id: user.id,
    email: user.email,
    name: "U9 Integration User",
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(JWT_SECRET));
  return `atom_auth=${token}`;
}

describe("U9 user update validation", () => {
  it.each([
    { name: "string false", targetRole: "admin", changes: { is_active: "false" } },
    { name: "zero", targetRole: "admin", changes: { is_active: 0 } },
    { name: "null", targetRole: "admin", changes: { is_active: null } },
    { name: "unknown role", targetRole: "editor", changes: { role: "owner" } },
  ] as const)("rejects $name without changing the user", async ({ targetRole, changes }) => {
    const actingAdmin = await createUser("admin");
    const target = await createUser(targetRole);
    const before = await findUserById(getIntegrationTestPool(), target.id);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/config/users/${target.id}`,
      headers: { cookie: await cookieFor(actingAdmin) },
      payload: changes,
    });

    expect({
      status: response.statusCode,
      user: await findUserById(getIntegrationTestPool(), target.id),
    }).toEqual({ status: 400, user: before });
  });

  it("continues to accept valid roles and boolean active values", async () => {
    const actingAdmin = await createUser("admin");
    const roleTarget = await createUser("editor");
    const activeTarget = await createUser("viewer");
    const cookie = await cookieFor(actingAdmin);

    const roleResponse = await app.inject({
      method: "PATCH",
      url: `/api/config/users/${roleTarget.id}`,
      headers: { cookie },
      payload: { role: "viewer" },
    });
    const activeResponse = await app.inject({
      method: "PATCH",
      url: `/api/config/users/${activeTarget.id}`,
      headers: { cookie },
      payload: { is_active: false },
    });

    expect(roleResponse.statusCode).toBe(200);
    expect((await findUserById(getIntegrationTestPool(), roleTarget.id))?.role).toBe("viewer");
    expect(activeResponse.statusCode).toBe(200);
    expect((await findUserById(getIntegrationTestPool(), activeTarget.id))?.is_active).toBe(false);
  });
});

describe("U9 PostgreSQL last-admin serialization", () => {
  it("keeps an active admin when two admins are removed concurrently", async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const pool = getIntegrationTestPool();
      await pool.query("DELETE FROM users");
      const demoteTarget = await createUser("admin");
      const deactivateTarget = await createUser("admin");
      const [demoteCookie, deactivateCookie] = await Promise.all([
        cookieFor(demoteTarget),
        cookieFor(deactivateTarget),
      ]);

      const responses = await Promise.all([
        app.inject({
          method: "PATCH",
          url: `/api/config/users/${demoteTarget.id}`,
          headers: { cookie: demoteCookie },
          payload: { role: "editor" },
        }),
        app.inject({
          method: "PATCH",
          url: `/api/config/users/${deactivateTarget.id}`,
          headers: { cookie: deactivateCookie },
          payload: { is_active: false },
        }),
      ]);
      const successfulUpdates = responses.filter((response) => response.statusCode === 200).length;
      const activeAdmins = await countAdmins(pool);

      expect({ attempt, successfulUpdates, activeAdmins }).toEqual({
        attempt,
        successfulUpdates: 1,
        activeAdmins: 1,
      });
    }
  }, 60000);
});
