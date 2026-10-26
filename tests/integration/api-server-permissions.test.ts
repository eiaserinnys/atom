import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { SignJWT } from "jose";

import { authMiddleware } from "../../src/api/middleware/auth.js";
import { agentKeyVerifier } from "../../src/api/agent-key-auth.js";
import { batchRoutes } from "../../src/api/routes/batch.js";
import { cardApiRoutes } from "../../src/api/routes/card_api.js";
import { cardRoutes } from "../../src/api/routes/cards.js";
import { configRoutes } from "../../src/api/routes/config.js";
import { createSearchEvaluateRoutes } from "../../src/api/routes/search-evaluate.js";
import { treeRoutes } from "../../src/api/routes/tree.js";
import { insertUser } from "../../src/db/queries/users.js";
import { createCard } from "../../src/services/card.service.js";
import { getIntegrationTestPool, setupIntegrationTestDb } from "./integration-harness.js";

setupIntegrationTestDb();

const JWT_SECRET = "server-permissions-integration-secret";
const originalEnv = { ...process.env };
let app: FastifyInstance;

beforeAll(() => {
  process.env["JWT_SECRET"] = JWT_SECRET;
  process.env["GOOGLE_CLIENT_ID"] = "integration-test-client";
  delete process.env["SLACK_CLIENT_ID"];
  delete process.env["AUTH_BYPASS"];
});

afterAll(() => {
  process.env = { ...originalEnv };
});

beforeEach(async () => {
  agentKeyVerifier.clear();
  app = Fastify({ logger: false });
  await app.register(cookie);
  app.addHook("preHandler", authMiddleware);
  await app.register(cardRoutes);
  await app.register(treeRoutes);
  await app.register(batchRoutes);
  await app.register(configRoutes);
  await app.register(cardApiRoutes);
  await app.register(createSearchEvaluateRoutes({
    evaluate: async ({ query }) => ({
      evaluation_id: "evaluation-test",
      query,
      model: "jev-latest",
      results: [],
      skipped: [],
      audit: { calls: [] },
    }),
  }));
});

afterEach(async () => {
  await app.close();
});

async function issueCookie(user: { id: string; email: string }, tokenRole: "admin" | "editor" | "viewer") {
  const token = await new SignJWT({
    id: user.id,
    email: user.email,
    name: "Integration User",
    role: tokenRole,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(JWT_SECRET));
  return `atom_auth=${token}`;
}

describe("server-side user permissions", () => {
  it("uses the database role and blocks viewer writes while allowing read requests", async () => {
    const user = await insertUser(getIntegrationTestPool(), {
      email: "viewer-permissions@example.test",
      display_name: "Viewer",
      role: "viewer",
    });
    const { card, node_id: nodeId } = await createCard({
      card_type: "structure",
      title: "Viewer readable root",
    });
    const cookieHeader = await issueCookie(user, "admin");
    const headers = { cookie: cookieHeader };

    expect((await app.inject({ method: "GET", url: "/tree", headers })).statusCode).toBe(200);
    expect((await app.inject({
      method: "POST",
      url: `/tree/${nodeId}/compile`,
      headers,
      payload: {},
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: "POST",
      url: "/search/evaluate",
      headers,
      payload: { query: "viewer read", card_ids: [card.id] },
    })).statusCode).toBe(200);

    expect((await app.inject({
      method: "PUT",
      url: `/cards/${card.id}`,
      headers,
      payload: { title: "Viewer cannot edit" },
    })).statusCode).toBe(403);
    expect((await app.inject({
      method: "POST",
      url: "/batch",
      headers,
      payload: { operations: [] },
    })).statusCode).toBe(403);
    expect((await app.inject({
      method: "DELETE",
      url: `/tree/${nodeId}`,
      headers,
    })).statusCode).toBe(403);
  });

  it("rejects the next request after a user's database deactivation", async () => {
    const user = await insertUser(getIntegrationTestPool(), {
      email: "deactivate-permissions@example.test",
      display_name: "Soon inactive",
      role: "editor",
    });
    const headers = { cookie: await issueCookie(user, "editor") };

    expect((await app.inject({ method: "GET", url: "/tree", headers })).statusCode).toBe(200);
    await getIntegrationTestPool().query(
      "UPDATE users SET is_active = false WHERE id = $1",
      [user.id],
    );
    expect((await app.inject({ method: "GET", url: "/tree", headers })).statusCode).toBe(401);
  });

  it("limits agent-key management to current database admins", async () => {
    const editor = await insertUser(getIntegrationTestPool(), {
      email: "editor-permissions@example.test",
      display_name: "Editor",
      role: "editor",
    });
    const admin = await insertUser(getIntegrationTestPool(), {
      email: "admin-permissions@example.test",
      display_name: "Admin",
      role: "admin",
    });
    const editorHeaders = { cookie: await issueCookie(editor, "editor") };
    const adminHeaders = { cookie: await issueCookie(admin, "admin") };

    expect((await app.inject({
      method: "POST",
      url: "/api/config/agents",
      headers: editorHeaders,
      payload: { agent_id: "editor-created-agent" },
    })).statusCode).toBe(403);

    const created = await app.inject({
      method: "POST",
      url: "/api/config/agents",
      headers: adminHeaders,
      payload: { agent_id: "admin-created-agent" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json<{ scope: string }>().scope).toBe("write");
    const agentId = created.json<{ id: string }>().id;
    expect((await app.inject({
      method: "GET",
      url: "/api/config/agents",
      headers: editorHeaders,
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: "POST",
      url: `/api/config/agents/${agentId}/reissue`,
      headers: editorHeaders,
    })).statusCode).toBe(403);
    expect((await app.inject({
      method: "PATCH",
      url: `/api/config/agents/${agentId}`,
      headers: editorHeaders,
      payload: { scope: "read" },
    })).statusCode).toBe(403);

    await getIntegrationTestPool().query(
      "UPDATE users SET role = 'editor' WHERE id = $1",
      [admin.id],
    );
    expect((await app.inject({
      method: "POST",
      url: "/api/config/agents",
      headers: adminHeaders,
      payload: { agent_id: "demoted-admin-agent" },
    })).statusCode).toBe(403);
  });
});
